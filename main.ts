import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import { Client, Authenticator } from 'minecraft-launcher-core';
import { Auth } from 'msmc';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as net from 'net';
import AdmZip from 'adm-zip';

let microsoftAuthToken: any = null;
// Evita inicios duplicados y mantiene vivo el launcher mientras prepara/ejecuta Minecraft.
let launchInProgress = false;
let p2pServer: net.Server | null = null;
let p2pClientSocket: net.Socket | null = null;

if (require('electron-squirrel-startup')) {
  app.quit();
}

// Colocá estos eventos DESPUÉS de definir saveLauncherLog().

process.on('uncaughtException', (error) => {
  saveLauncherLog(
    `[ERROR FATAL] ${error.stack || error.message}`
  );
  console.error('[Nocturn] Error fatal:', error);
});

process.on('unhandledRejection', (reason) => {
  const message =
    reason instanceof Error
      ? reason.stack || reason.message
      : String(reason);

  saveLauncherLog(`[PROMESA RECHAZADA] ${message}`);
  console.error('[Nocturn] Promesa rechazada:', reason);
});

app.on('before-quit', () => {
  saveLauncherLog(
    'Electron está intentando cerrar Nocturn Launcher.'
  );
});
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    height: 720,
    width: 980,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // No permitir que la ventana desaparezca mientras Minecraft se prepara o está abierto.
  mainWindow.on('close', (event) => {
    if (launchInProgress) {
      event.preventDefault();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      saveLauncherLog('Se bloqueó el cierre de la ventana mientras Minecraft estaba iniciando/ejecutándose.');
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    saveLauncherLog(`El proceso de renderizado de la ventana terminó: ${details.reason} (código ${details.exitCode}).`);
    if (!mainWindow.isDestroyed()) {
      mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
    }
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
};

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;

  // Si Minecraft está iniciando o ejecutándose, no terminar Electron por perder la ventana.
  // Recreamos la ventana del launcher para que el usuario pueda ver los diagnósticos.
  if (launchInProgress) {
    saveLauncherLog('La ventana del launcher se cerró durante el inicio/juego; se intentará recrear.');
    createWindow();
    return;
  }

  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

function getMinecraftRoot(): string {
  return path.resolve('./.minecraft_launcher_custom');
}

function getSettingsPath(): string {
  return path.join(getMinecraftRoot(), 'launcher_settings.json');
}

function getNocturnLogsDir(): string {
  return path.join(app.getPath('userData'), 'logs');
}

function saveLauncherLog(message: string): void {
  try {
    const logsDir = getNocturnLogsDir();
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(path.join(logsDir, 'nocturn-launcher.log'),
      `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch (error) {
    console.error('[Nocturn] No se pudo guardar el log:', error);
  }
}

function sendLaunchDiagnostic(message: string, details?: unknown): void {
  const detailText = details instanceof Error
    ? `${details.message}${details.stack ? `\n${details.stack}` : ''}`
    : details === undefined ? '' : String(details);
  saveLauncherLog(`${message}${detailText ? `\n${detailText}` : ''}`);
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send('launch-diagnostic', {
      message, details: detailText,
      logPath: path.join(getNocturnLogsDir(), 'nocturn-launcher.log')
    });
  }
}

ipcMain.handle('open-launch-logs', async () => {
  const logsDir = getNocturnLogsDir();
  fs.mkdirSync(logsDir, { recursive: true });
  const logPath = path.join(logsDir, 'nocturn-launcher.log');
  if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, 'Registro de Nocturn Launcher\\n', 'utf8');
  const errorMessage = await shell.openPath(logPath);
  if (errorMessage) throw new Error(errorMessage);
  return { success: true, path: logPath };
});


ipcMain.handle('save-user-settings', async (event, settings) => {
  try {
    const root = getMinecraftRoot();
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('load-user-settings', async () => {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {}
  return null;
});

async function getPublicIP(): Promise<string> {
  return new Promise((resolve) => {
    https.get('https://api.ipify.org', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data.trim()));
    }).on('error', () => resolve('127.0.0.1'));
  });
}

ipcMain.handle('start-p2p-host', async (event, lanPort: number) => {
  try {
    if (p2pServer) {
      p2pServer.close();
    }

    p2pServer = net.createServer((clientSocket) => {
      const targetSocket = new net.Socket();
      
      targetSocket.connect(lanPort, '127.0.0.1', () => {
        clientSocket.pipe(targetSocket);
        targetSocket.pipe(clientSocket);
      });

      targetSocket.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => targetSocket.destroy());
    });

    p2pServer.listen(lanPort, () => {
      console.log(`[P2P HOST] Escuchando en puerto ${lanPort}`);
    });

    const publicIp = await getPublicIP();
    const rawCode = `NOCTURN-${publicIp}:${lanPort}`;
    return { success: true, inviteCode: rawCode, port: lanPort };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('connect-p2p-client', async (event, connectionCode: string) => {
  try {
    const cleanCode = connectionCode.replace('NOCTURN-', '').trim();
    const [remoteIp, remotePortStr] = cleanCode.split(':');
    const remotePort = parseInt(remotePortStr) || 25565;

    if (p2pServer) p2pServer.close();

    p2pServer = net.createServer((localClient) => {
      const remoteSocket = new net.Socket();
      remoteSocket.connect(remotePort, remoteIp, () => {
        localClient.pipe(remoteSocket);
        remoteSocket.pipe(localClient);
      });

      remoteSocket.on('error', () => localClient.destroy());
      localClient.on('error', () => remoteSocket.destroy());
    });

    p2pServer.listen(25565, () => {
      console.log(`[P2P CLIENT] Conectado localmente a ${remoteIp}:${remotePort}`);
    });

    return { success: true, localAddress: '127.0.0.1:25565' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-p2p-session', async () => {
  if (p2pServer) {
    p2pServer.close();
    p2pServer = null;
  }
  if (p2pClientSocket) {
    p2pClientSocket.destroy();
    p2pClientSocket = null;
  }
  return { success: true };
});

function getGameDirectory(baseRoot: string, version: string): string {
  if (version.includes("Fabric")) {
    const instanceDir = path.join(baseRoot, "instances", version);
    if (!fs.existsSync(instanceDir)) {
      fs.mkdirSync(instanceDir, { recursive: true });
    }
    const modsDir = path.join(instanceDir, "mods");
    if (!fs.existsSync(modsDir)) {
      fs.mkdirSync(modsDir, { recursive: true });
    }
    return instanceDir;
  }
  return baseRoot;
}

async function fetchImageAsBase64(url: string): Promise<string> {
  return new Promise((resolve) => {
    if (!url) {
      resolve('');
      return;
    }
    const reqUrl = url.startsWith('http') ? url : `https://${url.replace(/^\/\//, '')}`;
    
    https.get(reqUrl, { headers: { 'User-Agent': 'CustomMinecraftLauncher/1.0.0' } }, (res) => {
      if (res.statusCode !== 200) {
        resolve('');
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const base64 = buffer.toString('base64');
        const mime = res.headers['content-type'] || 'image/png';
        resolve(`data:${mime};base64,${base64}`);
      });
    }).on('error', () => {
      resolve('');
    });
  });
}

// BÚSQUEDA DE MODS CON SOPORTE DE CATEGORÍAS (FACETS)
ipcMain.handle('search-mods', async (event, { query, gameVersion, category, offset }) => {
  try {
    const cleanVersion = gameVersion ? gameVersion.split('-')[0] : '1.21.1';
    const isFabric = gameVersion && gameVersion.includes('Fabric');
    const currentOffset = offset || 0;
    const limit = 15;

    let facetsArray: string[][] = [
      [`project_type:mod`], 
      [`versions:${cleanVersion}`]
    ];

    if (isFabric) {
      facetsArray.push([`categories:fabric`]);
    }

    if (category && category.trim() !== '') {
      facetsArray.push([`categories:${category}`]);
    }

    const facets = encodeURIComponent(JSON.stringify(facetsArray));
    const searchUrl = query && query.trim() !== '' 
      ? `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&facets=${facets}&index=downloads&offset=${currentOffset}&limit=${limit}`
      : `https://api.modrinth.com/v2/search?facets=${facets}&index=downloads&offset=${currentOffset}&limit=${limit}`;

    return new Promise((resolve) => {
      const options = { headers: { 'User-Agent': 'CustomMinecraftLauncher/1.0.0' } };

      https.get(searchUrl, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', async () => {
          try {
            if (res.statusCode !== 200) {
              resolve([]);
              return;
            }
            const parsed = JSON.parse(data);
            const hits = parsed.hits || [];
            
            const processedHits = await Promise.all(hits.map(async (mod: any) => {
              const projId = mod.project_id || mod.slug;
              let rawIconUrl = mod.icon_url;
              if (!rawIconUrl || !rawIconUrl.startsWith('http')) {
                rawIconUrl = `https://cdn.modrinth.com/data/${projId}/icon.png`;
              }
              
              const base64Icon = await fetchImageAsBase64(rawIconUrl);
              return { 
                ...mod, 
                icon_url: base64Icon, 
                project_id: projId,
                author: mod.author || 'Desconocido'
              };
            }));

            resolve(processedHits);
          } catch (e) {
            resolve([]);
          }
        });
      }).on('error', () => resolve([]));
    });
  } catch (err: any) {
    return [];
  }
});

ipcMain.handle('get-mod-details', async (event, projectId) => {
  try {
    const url = `https://api.modrinth.com/v2/project/${projectId}`;
    const options = { headers: { 'User-Agent': 'CustomMinecraftLauncher/1.0.0' } };

    return new Promise((resolve) => {
      https.get(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              resolve(null);
              return;
            }
            const project = JSON.parse(data);
            resolve({
              body: project.body || project.description || "Sin descripción disponible.",
              downloads: project.downloads,
              author: project.team ? "Equipo de desarrollo" : "Desconocido"
            });
          } catch (e) {
            resolve(null);
          }
        });
      }).on('error', () => resolve(null));
    });
  } catch (err) {
    return null;
  }
});

ipcMain.handle('get-mod-versions', async (event, { projectId, gameVersion }) => {
  try {
    const url = `https://api.modrinth.com/v2/project/${projectId}/version?loaders=["fabric"]&game_versions=["${gameVersion}"]`;
    const options = { headers: { 'User-Agent': 'CustomMinecraftLauncher/1.0.0' } };

    return new Promise((resolve, reject) => {
      https.get(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const versions = JSON.parse(data);
            resolve(versions || []);
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  } catch (err: any) {
    return [];
  }
});

ipcMain.handle('install-mod-file', async (event, { downloadUrl, fileName, gameVersion }) => {
  try {
    const minecraftRoot = getMinecraftRoot();
    const fullVersionTag = `${gameVersion}-Fabric`;
    const instanceDir = getGameDirectory(minecraftRoot, fullVersionTag);
    
    const modsFolder = path.join(instanceDir, "mods");
    if (!fs.existsSync(modsFolder)) fs.mkdirSync(modsFolder, { recursive: true });

    const destJarPath = path.join(modsFolder, fileName);
    const options = { headers: { 'User-Agent': 'CustomMinecraftLauncher/1.0.0' } };

    await new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(destJarPath);
      const request = (urlStr: string) => {
        https.get(urlStr, options, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            request(res.headers.location!);
            return;
          }
          res.pipe(file);
          file.on('finish', () => { file.close(() => resolve()); });
        }).on('error', reject);
      };
      request(downloadUrl);
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

let openingModsFolder = false;
ipcMain.on('open-mods-folder', async (_event, version: string) => {
  if (openingModsFolder) return;
  openingModsFolder = true;
  try {
    const minecraftRoot = getMinecraftRoot();
    const instanceDir = getGameDirectory(minecraftRoot, version);
    const modsFolder = path.join(instanceDir, 'mods');
    fs.mkdirSync(modsFolder, { recursive: true });
    const error = await shell.openPath(modsFolder);
    if (error) sendLaunchDiagnostic('No se pudo abrir la carpeta de mods.', error);
  } catch (err) {
    sendLaunchDiagnostic('Error al abrir la carpeta de mods.', err);
  } finally {
    setTimeout(() => { openingModsFolder = false; }, 700);
  }
});

ipcMain.handle('select-skin-file', async () => {
  const options = {
    title: 'Elegir skin de Minecraft',
    properties: ['openFile'] as Array<'openFile'>,
    filters: [{ name: 'Imagen PNG de skin', extensions: ['png'] }]
  };
  const parent = BrowserWindow.getFocusedWindow();
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const source = result.filePaths[0];
  const bytes = fs.readFileSync(source);
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 100 || !bytes.subarray(0, 8).equals(pngSignature)) {
    return { success: false, error: 'El archivo elegido no parece ser un PNG válido.' };
  }
  const skinDir = path.join(app.getPath('userData'), 'skins');
  fs.mkdirSync(skinDir, { recursive: true });
  const savedPath = path.join(skinDir, 'selected-skin.png');
  fs.copyFileSync(source, savedPath);
  return { success: true, name: path.basename(source), dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, path: savedPath };
});

ipcMain.handle('save-skin-selection', async (_event, data: { name: string; model: string; skinUrl: string; capeUrl?: string }) => {
  try {
    const dir = app.getPath('userData');
    const settingsPath = path.join(dir, 'nocturn-skin.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ ...data, savedAt: new Date().toISOString() }, null, 2), 'utf8');
    return { success: true, path: settingsPath };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

function getRequiredJavaVersion(versionStr: string): number {
  if (versionStr.includes("1.21") || versionStr.includes("1.20.5") || versionStr.includes("1.20.6")) return 21;
  if (versionStr.includes("1.17") || versionStr.includes("1.18") || versionStr.includes("1.19") || versionStr.includes("1.20")) return 17;
  return 8;
}

function getJavaDownloadUrl(majorVersion: number): string {
  if (process.platform === 'win32') {
    switch (majorVersion) {
      case 21: return 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.3%2B9/OpenJDK21U-jre_x64_windows_hotspot_21.0.3_9.zip';
      case 17: return 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.11%2B9/OpenJDK17U-jre_x64_windows_hotspot_17.0.11_9.zip';
      default: return 'https://github.com/adoptium/temurin8-binaries/releases/download/jdk8u412-b08/OpenJDK8U-jre_x64_windows_hotspot_8u412b08.zip';
    }
  }
  throw new Error("Sistema operativo no soportado.");
}

function findJavaExe(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findJavaExe(fullPath);
        if (found) return found;
      } else if (entry.name.toLowerCase() === 'javaw.exe') {
        return fullPath;
      }
    }
  } catch (e) {}
  return null;
}

async function ensureJavaRuntime(majorVersion: number): Promise<string> {
  const runtimesDir = path.resolve('./runtimes');
  const targetJavaDir = path.join(runtimesDir, `java-${majorVersion}`);

  const existingJava = findJavaExe(targetJavaDir);
  if (existingJava) return existingJava;

  if (fs.existsSync(targetJavaDir)) {
    try { fs.rmSync(targetJavaDir, { recursive: true, force: true }); } catch (e) {}
  }
  if (!fs.existsSync(runtimesDir)) fs.mkdirSync(runtimesDir, { recursive: true });

  const zipUrl = getJavaDownloadUrl(majorVersion);
  const zipPath = path.join(runtimesDir, `java-${majorVersion}.zip`);

  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(zipPath);
    const request = (url: string) => {
      https.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          request(response.headers.location!);
          return;
        }
        response.pipe(file);
        file.on('finish', () => { file.close(() => resolve()); });
      }).on('error', (err) => {
        try { fs.unlinkSync(zipPath); } catch (e) {}
        reject(err);
      });
    };
    request(zipUrl);
  });

  const zip = new AdmZip(zipPath);
  const zipEntries = zip.getEntries();
  let rootFolderPrefix = "";
  for (const entry of zipEntries) {
    if (entry.isDirectory) {
      const parts = entry.entryName.split('/');
      if (parts.length > 1 && parts[0].length > 0) {
        rootFolderPrefix = parts[0] + "/";
        break;
      }
    }
  }

  fs.mkdirSync(targetJavaDir, { recursive: true });
  zipEntries.forEach((entry) => {
    if (entry.isDirectory) return;
    let targetRelativePath = entry.entryName;
    if (rootFolderPrefix && targetRelativePath.startsWith(rootFolderPrefix)) {
      targetRelativePath = targetRelativePath.substring(rootFolderPrefix.length);
    }
    if (!targetRelativePath) return;
    const fullDestPath = path.join(targetJavaDir, targetRelativePath);
    const destDir = path.dirname(fullDestPath);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(fullDestPath, entry.getData());
  });

  try { fs.unlinkSync(zipPath); } catch (e) {}
  const finalJavaPath = findJavaExe(targetJavaDir);
  if (!finalJavaPath) throw new Error(`No se pudo localizar javaw.exe`);
  return finalJavaPath;
}

ipcMain.handle('login-microsoft', async () => {
  try {
    const authManager = new Auth("select_account");
    const xboxManager = await authManager.launch("raw");
    const token = await xboxManager.getMinecraft();
    microsoftAuthToken = token.mclc();
    return { success: true, name: (token.profile as any).name, token: microsoftAuthToken };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.on('launch-game', async (event, { version, username, isPremium, savedToken }) => {
  if (launchInProgress) {
    sendLaunchDiagnostic('Se ignoró una segunda solicitud: Minecraft ya se está preparando o ejecutando.');
    return;
  }
  launchInProgress = true;
  sendLaunchDiagnostic(`Solicitud de inicio recibida. Versión: ${version || 'desconocida'}.`);
  try {
  if (savedToken && isPremium && !microsoftAuthToken) {
    microsoftAuthToken = savedToken;
  }

  const minecraftRoot = getMinecraftRoot();
  sendLaunchDiagnostic(`Carpeta de Minecraft: ${minecraftRoot}. Versión recibida: ${String(version)}.`);
  if (!fs.existsSync(minecraftRoot)) fs.mkdirSync(minecraftRoot, { recursive: true });

  const gameDirectory = getGameDirectory(minecraftRoot, version);
  const modsDirectory = path.join(gameDirectory, "mods");
  if (!fs.existsSync(modsDirectory)) fs.mkdirSync(modsDirectory, { recursive: true });

  const rootModsDirectory = path.join(minecraftRoot, "mods");
  if (!fs.existsSync(rootModsDirectory)) fs.mkdirSync(rootModsDirectory, { recursive: true });

  try {
    const existingRootMods = fs.readdirSync(rootModsDirectory);
    for (const file of existingRootMods) {
      if (file.endsWith('.jar')) fs.unlinkSync(path.join(rootModsDirectory, file));
    }
    if (version.includes("Fabric")) {
      const instanceModFiles = fs.readdirSync(modsDirectory).filter(f => f.endsWith('.jar'));
      for (const file of instanceModFiles) {
        fs.copyFileSync(path.join(modsDirectory, file), path.join(rootModsDirectory, file));
      }
    }
  } catch (err) {}

  const requiredJavaMajor = getRequiredJavaVersion(version);
  let javaExecutablePath: string | null = null;
  try {
    javaExecutablePath = await ensureJavaRuntime(requiredJavaMajor);
  } catch (err) {
    sendLaunchDiagnostic('No se pudo preparar Java. Minecraft no se inició.', err);
    launchInProgress = false;
    return;
  }

  const launcher = new Client();
  const authConfig = isPremium && microsoftAuthToken ? microsoftAuthToken : Authenticator.getAuth(username || "Jugador1");

  let versionConfig: any;
  if (version === "1.20.1-Fabric") {
    versionConfig = { number: "1.20.1", type: "release", custom: "fabric-loader-0.20.1-1.20.1" };
  } else if (String(version).includes("1.21.1") && String(version).toLowerCase().includes("fabric")) {
    const fabricProfileId = "fabric-loader-0.17.3-1.21.1";
    const fabricVersionFolder = path.join(minecraftRoot, "versions", fabricProfileId);
    const fabricJsonPath = path.join(fabricVersionFolder, `${fabricProfileId}.json`);
    const officialMetaUrl = "https://meta.fabricmc.net/v2/versions/loader/1.21.1/0.17.3/profile/json";

    // Descarga siempre que falte el perfil; valida respuesta HTTP y JSON antes de lanzar.
    if (!fs.existsSync(fabricJsonPath)) {
      fs.mkdirSync(fabricVersionFolder, { recursive: true });
      await new Promise<void>((resolve, reject) => {
        const requestProfile = (url: string, redirects = 0): void => {
          https.get(url, { headers: { 'User-Agent': 'NocturnLauncher/1.0.0' } }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
              res.resume();
              if (redirects >= 5) { reject(new Error('Demasiadas redirecciones al descargar el perfil de Fabric.')); return; }
              requestProfile(new URL(res.headers.location, url).toString(), redirects + 1);
              return;
            }
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                if (res.statusCode !== 200) throw new Error(`Fabric respondió HTTP ${res.statusCode}.`);
                const profile = JSON.parse(data);
                if (!profile || profile.id !== fabricProfileId || !Array.isArray(profile.libraries)) {
                  throw new Error('El perfil descargado de Fabric no es válido o no corresponde a Loader 0.17.3.');
                }
                fs.writeFileSync(fabricJsonPath, JSON.stringify(profile, null, 2), 'utf8');
                resolve();
              } catch (error) {
                reject(error);
              }
            });
            res.on('error', reject);
          }).on('error', reject);
        };
        requestProfile(officialMetaUrl);
      });
    } else {
      // Si el archivo existe pero está corrupto o pertenece a otra versión, volver a descargarlo.
      try {
        const existingProfile = JSON.parse(fs.readFileSync(fabricJsonPath, 'utf8'));
        if (existingProfile.id !== fabricProfileId || !Array.isArray(existingProfile.libraries)) {
          fs.unlinkSync(fabricJsonPath);
          throw new Error('El perfil local de Fabric no es válido. Volvé a iniciar para descargarlo de nuevo.');
        }
      } catch (error) {
        throw new Error(`No se pudo validar el perfil de Fabric 0.17.3: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    versionConfig = { number: "1.21.1", type: "release", custom: fabricProfileId };
  } else {
    versionConfig = { number: version, type: "release" };
  }

  const opts: any = {
    authorization: authConfig,
    root: minecraftRoot,
    gameDirectory: gameDirectory,
    version: versionConfig,
    memory: { max: "4G", min: "2G" },
    javaArgs: ["-XX:+UnlockExperimentalVMOptions", "-XX:+UseG1GC", "-XX:G1NewSizePercent=20", "-XX:G1ReservePercent=20", "-XX:MaxGCPauseMillis=50", "-XX:G1HeapRegionSize=32M"]
  };

  if (javaExecutablePath) opts.javaPath = javaExecutablePath;
  opts.detached = true;

  const mainWindow = BrowserWindow.getAllWindows()[0];

  launcher.on('download', (e) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', { type: 'download', text: `Descargando: ${e}` });
    }
  });

  launcher.on('progress', (packet) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const percentage = Number.isFinite(packet.current) && Number.isFinite(packet.total) && packet.total > 0 ? Math.max(0, Math.min(100, Math.round((packet.current / packet.total) * 100))) : 0;
      mainWindow.webContents.send('download-progress', { type: 'progress', percent: percentage, text: `Descargando archivos: ${percentage}%` });
    }
  });

  launcher.on('error', (err: any) => {
    sendLaunchDiagnostic('Error informado por el launcher de Minecraft.', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-error', err?.message || String(err));
    }
  });

  launcher.on('debug', (message: any) => {
    saveLauncherLog(`[Minecraft debug] ${typeof message === 'string' ? message : JSON.stringify(message)}`);
  });
  let incompatibilityNoticeSent = false;
  const inspectMinecraftOutput = (raw: any) => {
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    saveLauncherLog(`[Minecraft] ${text}`);
    const lower = text.toLowerCase();
    const looksLikeFabricModError =
      lower.includes('incompatible mods found') ||
      lower.includes('dependencies are missing') ||
      lower.includes('depends on') && (lower.includes('fabricloader') || lower.includes('mod')) ||
      lower.includes('mod resolution failed') ||
      lower.includes('hard_dep_no_candidate');
    if (looksLikeFabricModError && !incompatibilityNoticeSent) {
      incompatibilityNoticeSent = true;
      const summary = text.slice(0, 12000);
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send('mod-incompatibility', {
          title: 'Incompatibilidades de mods detectadas',
          message: 'Fabric detectó mods incompatibles o dependencias faltantes. Nocturn sigue abierto para que puedas revisar el diagnóstico.',
          details: summary
        });
      }
      sendLaunchDiagnostic('Fabric detectó incompatibilidades o dependencias faltantes.', summary);
    }
  };
  launcher.on('data', inspectMinecraftOutput);

  launcher.on('close', (code: any) => {
    launchInProgress = false;
    sendLaunchDiagnostic(`El proceso de Minecraft terminó. Código: ${code ?? 'desconocido'}.`);
    const currentWindow = BrowserWindow.getAllWindows()[0];
    if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send('game-closed', code);
  });

  try {
    const launchResult = launcher.launch(opts);
    if (launchResult && typeof (launchResult as any).catch === 'function') {
      (launchResult as any).catch((err: any) => {
        launchInProgress = false;
        sendLaunchDiagnostic('Falló el inicio de Minecraft (promesa rechazada).', err);
      });
    }
  } catch (err) {
    launchInProgress = false;
    sendLaunchDiagnostic('Excepción al iniciar Minecraft.', err);
  }
  } catch (err) {
    launchInProgress = false;
    sendLaunchDiagnostic('Error inesperado preparando el inicio de Minecraft.', err);
  }
});
