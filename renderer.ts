import { supabase } from './supabase';
import * as skinview3d from 'skinview3d';

(window as any).skinview3d = {
  ...skinview3d,
  SkinViewer: (skinview3d as any).SkinViewer,
  WalkingAnimation: (skinview3d as any).WalkingAnimation
};

export {};

interface ElectronAPI {
  loginMicrosoft: () => Promise<any>;
  saveUserSettings: (settings: any) => Promise<any>;
  loadUserSettings: () => Promise<any>;
  launchGame: (data: { version: string; username: string; isPremium: boolean; savedToken: any }) => void;
  openModsFolder: (version: string) => void;
  searchMods: (data: { query: string; gameVersion: string; category?: string; offset?: number }) => Promise<any>;
  getModDetails: (projectId: string) => Promise<any>;
  getModVersions: (data: { projectId: string; gameVersion: string }) => Promise<any>;
  installModFile: (data: { downloadUrl: string; fileName: string; gameVersion: string }) => Promise<any>;
  startP2PHost: (lanPort: number) => Promise<any>;
  connectP2PClient: (connectionCode: string) => Promise<any>;
  stopP2PSession: () => Promise<any>;
  onDownloadProgress: (callback: (data: { type: string; percent?: number; text: string }) => void) => void;
  onDownloadError: (callback: (errorText: string) => void) => void;
  onGameClosed: (callback: (code: number) => void) => void;
  onLaunchDiagnostic: (callback: (data: { message: string; details?: string; logPath?: string }) => void) => void;
  onModIncompatibility: (callback: (data: { title: string; message: string; details: string }) => void) => void;
  selectSkinFile: () => Promise<any>;
  saveSkinSelection: (data: { name: string; model: string; skinUrl: string; capeUrl?: string }) => Promise<any>;
  openLaunchLogs: () => Promise<any> | void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

let isPremium = false;
let savedMicrosoftToken: any = null;
let currentModVersions: any[] = [];
let currentSelectedMod: any = null;
let hasLoadedModsOnce = false;

let currentSearchQuery = '';
let currentCategory = '';
let currentOffset = 0;
const LIMIT_PER_PAGE = 15;

document.addEventListener('DOMContentLoaded', async () => {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab')!;
      const target = document.getElementById(targetId);
      if (target) target.classList.add('active');

      if (targetId === 'mods-tab' && !hasLoadedModsOnce) {
        hasLoadedModsOnce = true;
        currentOffset = 0;
        performSearch(currentSearchQuery, currentCategory, false);
      }
    });
  });

  const btnLaunch = document.getElementById('btn-launch');
  const btnMicrosoft = document.getElementById('btn-microsoft');
  const btnOpenMods = document.getElementById('btn-open-mods');
  const btnOpenLogs = document.getElementById('btn-open-logs');
  const btnSearch = document.getElementById('btn-search');
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const versionSelect = document.getElementById('version-select') as HTMLSelectElement;
  const usernameInput = document.getElementById('username') as HTMLInputElement;
  const accountStatus = document.getElementById('account-status');
  const btnLogout = document.getElementById('btn-logout');
  const statusText = document.getElementById('status-text');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  const btnLoadMore = document.getElementById('btn-load-more');

  // These elements are declared in the same scope as their event handlers.
  const userDropdown = document.getElementById('user-dropdown');
  const categoryBtns = document.querySelectorAll('.category-btn');

  // Nocturn account system using Supabase.
  const nocturnEmail = document.getElementById('nocturn-email') as HTMLInputElement | null;
  const nocturnPassword = document.getElementById('nocturn-password') as HTMLInputElement | null;
  const nocturnAuthStatus = document.getElementById('nocturn-auth-status');
  // These IDs must match the buttons in index.html.
  const btnNocturnLogin = document.getElementById('btn-nocturn-login') as HTMLButtonElement | null;
  const btnNocturnRegister = document.getElementById('btn-nocturn-register') as HTMLButtonElement | null;

  function setNocturnAuthStatus(message: string) {
    if (nocturnAuthStatus) nocturnAuthStatus.textContent = message;
  }

  function updateNocturnAuthUI(email?: string) {
    if (email) {
      setNocturnAuthStatus(`Sesión Nocturn iniciada: ${email}`);
      if (btnNocturnLogin) btnNocturnLogin.textContent = 'Sesión iniciada';
    } else {
      setNocturnAuthStatus('No has iniciado sesión en Nocturn.');
      if (btnNocturnLogin) btnNocturnLogin.textContent = 'Iniciar sesión';
    }
  }

  btnNocturnRegister?.addEventListener('click', async () => {
    const email = nocturnEmail?.value.trim() || '';
    const password = nocturnPassword?.value || '';

    if (!email || !password) {
      setNocturnAuthStatus('Ingresá tu correo y contraseña.');
      return;
    }

    if (password.length < 6) {
      setNocturnAuthStatus('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    btnNocturnRegister.disabled = true;
    setNocturnAuthStatus('Creando tu cuenta...');

    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;

      if (data.session) {
        updateNocturnAuthUI(data.user?.email || email);
      } else {
        setNocturnAuthStatus(
          'Cuenta creada. Revisá tu correo para confirmar el registro antes de iniciar sesión.'
        );
      }
    } catch (error) {
      console.error('[Nocturn] Error de registro:', error);
      setNocturnAuthStatus(
        error instanceof Error ? error.message : 'No se pudo crear la cuenta.'
      );
    } finally {
      btnNocturnRegister.disabled = false;
    }
  });

  btnNocturnLogin?.addEventListener('click', async () => {
    const email = nocturnEmail?.value.trim() || '';
    const password = nocturnPassword?.value || '';

    if (!email || !password) {
      setNocturnAuthStatus('Ingresá tu correo y contraseña.');
      return;
    }

    btnNocturnLogin.disabled = true;
    setNocturnAuthStatus('Iniciando sesión...');

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      updateNocturnAuthUI(data.user?.email || email);
      if (nocturnPassword) nocturnPassword.value = '';
    } catch (error) {
      console.error('[Nocturn] Error de inicio de sesión:', error);
      setNocturnAuthStatus(
        error instanceof Error ? error.message : 'No se pudo iniciar sesión.'
      );
    } finally {
      btnNocturnLogin.disabled = false;
    }
  });

  // Restore and observe the Nocturn session.
  const { data: initialSession, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    setNocturnAuthStatus('No se pudo recuperar la sesión de Nocturn.');
  } else {
    updateNocturnAuthUI(initialSession.session?.user.email);
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    updateNocturnAuthUI(session?.user.email);
  });

  // This menu action signs out of Nocturn only, not Microsoft.
  document.getElementById('menu-signout')?.addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('[Nocturn] Error al cerrar sesión:', error);
      setNocturnAuthStatus('No se pudo cerrar la sesión Nocturn.');
      return;
    }

    if (nocturnPassword) nocturnPassword.value = '';
    setNocturnAuthStatus('Sesión Nocturn cerrada.');
  });

  document.getElementById('menu-switch-account')?.addEventListener('click', () => {
    if (userDropdown) userDropdown.classList.remove('show');
    nocturnEmail?.focus();
  });

  categoryBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      categoryBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = btn.getAttribute('data-category') || '';
      currentOffset = 0;
      hasLoadedModsOnce = true;
      performSearch(currentSearchQuery, currentCategory, false);
    });
  });

  const btnAddFriend = document.getElementById('btn-add-friend');
  const friendInputNick = document.getElementById('friend-input-nick') as HTMLInputElement;
  const friendsList = document.getElementById('friends-list');
  const activeSessionCard = document.getElementById('active-session-card');

  const modModal = document.getElementById('mod-modal');
  const closeModal = document.getElementById('close-modal');
  const modalTitle = document.getElementById('modal-mod-title');
  const modalDesc = document.getElementById('modal-mod-description');
  const modalDownloads = document.getElementById('modal-mod-downloads');
  const modalIcon = document.getElementById('modal-mod-icon') as HTMLImageElement;
  const modalVersionSelect = document.getElementById('modal-version-select') as HTMLSelectElement;
  const modalBtnInstall = document.getElementById('modal-btn-install');

  let myFriends: { username: string; online: boolean; playing: string; inviteCode?: string }[] =
    JSON.parse(localStorage.getItem('nocturn_friends') || '[]');

  function saveFriends() {
    localStorage.setItem('nocturn_friends', JSON.stringify(myFriends));
  }

  function renderFriends() {
    if (!friendsList) return;
    friendsList.innerHTML = '';

    if (myFriends.length === 0) {
      friendsList.innerHTML = '<p style="font-size:12px; color:#a1a1aa; text-align:center; margin-top:20px;">No tienes amigos agregados aún.</p>';
      return;
    }

    myFriends.forEach((friend, index) => {
      const card = document.createElement('div');
      card.className = 'friend-card';

      const initial = friend.username.charAt(0).toUpperCase();
      const avatarDiv = document.createElement('div');
      avatarDiv.className = 'friend-avatar';
      avatarDiv.style.cssText = 'background: #2e1065; border: 1px solid #7c3aed; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 20px; color: #c084fc; border-radius: 8px; width: 56px; height: 56px; flex-shrink: 0;';
      avatarDiv.innerText = initial;

      const infoDiv = document.createElement('div');
      infoDiv.className = 'friend-info';
      infoDiv.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 4px;';
      infoDiv.innerHTML = `
        <h4 style="margin:0; font-size:15px; color:#ffffff;">${friend.username}</h4>
        <p style="margin:0; font-size:12px; color:#a1a1aa;">
          <span class="status-dot ${friend.online ? 'status-online' : 'status-offline'}"></span>
          ${friend.playing}
        </p>
      `;

      const actionDiv = document.createElement('div');
      actionDiv.style.cssText = 'display: flex; gap: 8px; align-items: center;';

      if (friend.online) {
        const joinBtn = document.createElement('button');
        joinBtn.className = 'btn btn-join';
        joinBtn.style.cssText = 'padding: 6px 12px; font-size:12px;';
        joinBtn.innerText = 'Unirse';

        joinBtn.addEventListener('click', async () => {
          const codeToUse = friend.inviteCode;
          if (!codeToUse) {
            alert(`El amigo ${friend.username} no tiene un código P2P registrado.`);
            return;
          }

          const res = await window.electronAPI.connectP2PClient(codeToUse);
          if (res.success) {
            const targetIp = '127.0.0.1:25565';
            await navigator.clipboard.writeText(targetIp);
            alert(`¡Conectado al mundo de ${friend.username} con éxito!\n\nLa IP [ ${targetIp} ] se copió al portapapeles.`);
          } else {
            alert(`Error al conectar con ${friend.username}: ${res.error}`);
            friend.inviteCode = '';
            saveFriends();
          }
        });
        actionDiv.appendChild(joinBtn);
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn';
      deleteBtn.style.cssText = 'padding: 6px 10px; font-size:12px; background: #ef4444; color: white;';
      deleteBtn.innerText = 'Eliminar';
      deleteBtn.addEventListener('click', () => {
        myFriends.splice(index, 1);
        saveFriends();
        renderFriends();
      });
      actionDiv.appendChild(deleteBtn);

      card.appendChild(avatarDiv);
      card.appendChild(infoDiv);
      card.appendChild(actionDiv);
      friendsList.appendChild(card);
    });
  }

  renderFriends();

  btnAddFriend?.addEventListener('click', () => {
    const nick = friendInputNick.value.trim();
    if (!nick) {
      alert('Introduce un nickname válido.');
      return;
    }
    myFriends.push({ username: nick, online: true, playing: 'En el menú principal', inviteCode: '' });
    saveFriends();
    friendInputNick.value = '';
    renderFriends();
  });

  const savedSettings = await window.electronAPI.loadUserSettings();
  if (savedSettings) {
    if (savedSettings.username && usernameInput) usernameInput.value = savedSettings.username;
    if (savedSettings.isPremium) {
      isPremium = true;
      savedMicrosoftToken = savedSettings.token;
      if (accountStatus) accountStatus.innerText = `Microsoft: ${savedSettings.username}`;
      if (usernameInput) {
        usernameInput.value = savedSettings.username;
        usernameInput.disabled = true;
      }
      if (btnLogout) btnLogout.style.display = 'inline-block';
    }
  }

  usernameInput?.addEventListener('input', async () => {
    if (!isPremium) {
      await window.electronAPI.saveUserSettings({
        username: usernameInput.value,
        isPremium: false,
        token: null
      });
    }
  });

  btnLogout?.addEventListener('click', async () => {
    isPremium = false;
    savedMicrosoftToken = null;
    if (accountStatus) accountStatus.innerText = 'Modo No Premium';
    if (btnLogout) btnLogout.style.display = 'none';
    if (usernameInput) {
      usernameInput.disabled = false;
      usernameInput.value = 'Jugador1';
    }
    await window.electronAPI.saveUserSettings({
      username: 'Jugador1',
      isPremium: false,
      token: null
    });
  });

  btnMicrosoft?.addEventListener('click', async () => {
    if (statusText) statusText.innerText = 'Iniciando sesión con Microsoft...';
    const res = await window.electronAPI.loginMicrosoft();
    if (res.success) {
      isPremium = true;
      savedMicrosoftToken = res.token;
      if (usernameInput) {
        usernameInput.value = res.name;
        usernameInput.disabled = true;
      }
      if (accountStatus) accountStatus.innerText = `Microsoft: ${res.name}`;
      if (btnLogout) btnLogout.style.display = 'inline-block';
      if (statusText) statusText.innerText = 'Sesión iniciada correctamente.';
      await window.electronAPI.saveUserSettings({
        username: res.name,
        isPremium: true,
        token: res.token
      });
    } else {
      if (statusText) statusText.innerText = `Error: ${res.error}`;
    }
  });

  btnLaunch?.addEventListener('click', () => {
    const version = versionSelect.value;
    const username = usernameInput.value.trim() || 'Jugador1';
    if (progressContainer) progressContainer.style.display = 'block';
    if (statusText) statusText.innerText = 'Preparando inicio...';
    if (activeSessionCard) activeSessionCard.style.display = 'block';
    window.electronAPI.launchGame({ version, username, isPremium, savedToken: savedMicrosoftToken });
  });

  let openingModsFromUI = false;
  btnOpenMods?.addEventListener('click', () => {
    if (openingModsFromUI) return;
    openingModsFromUI = true;
    window.electronAPI.openModsFolder(versionSelect.value);
    window.setTimeout(() => { openingModsFromUI = false; }, 800);
  });

  btnOpenLogs?.addEventListener('click', async () => {
    try {
      const result = await window.electronAPI.openLaunchLogs();
      if (result && result.success === false) {
        alert(`No se pudieron abrir los registros: ${result.error || 'error desconocido'}`);
      }
    } catch (error) {
      console.error('Error al abrir los registros del launcher:', error);
      alert('No se pudieron abrir los registros del launcher.');
    }
  });

  btnSearch?.addEventListener('click', () => {
    currentSearchQuery = searchInput.value.trim();
    currentOffset = 0;
    performSearch(currentSearchQuery, currentCategory, false);
  });

  searchInput?.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
      currentSearchQuery = searchInput.value.trim();
      currentOffset = 0;
      performSearch(currentSearchQuery, currentCategory, false);
    }
  });

  btnLoadMore?.addEventListener('click', () => {
    currentOffset += LIMIT_PER_PAGE;
    performSearch(currentSearchQuery, currentCategory, true);
  });

  versionSelect?.addEventListener('change', () => {
    if (hasLoadedModsOnce) {
      currentOffset = 0;
      performSearch(currentSearchQuery, currentCategory, false);
    }
  });

  async function performSearch(query: string, category: string, append: boolean) {
    const modsList = document.getElementById('mods-list');
    if (!modsList) return;

    if (!append) {
      modsList.innerHTML = '<p style="font-size:12px; color:#a1a1aa; text-align:center; margin-top:20px;">Buscando mods en Modrinth...</p>';
      if (btnLoadMore) btnLoadMore.style.display = 'none';
    } else if (btnLoadMore) {
      btnLoadMore.innerText = 'Cargando más...';
    }

    const results = await window.electronAPI.searchMods({
      query,
      gameVersion: versionSelect.value.split('-')[0],
      category,
      offset: currentOffset
    });

    renderModsList(results, append);
  }

  function renderModsList(mods: any[], append: boolean) {
    const modsList = document.getElementById('mods-list');
    if (!modsList) return;

    if (!append) modsList.innerHTML = '';

    if (!mods || mods.length === 0) {
      if (!append) {
        modsList.innerHTML = '<p style="font-size:12px; color:#a1a1aa; text-align:center; margin-top:20px;">No se encontraron mods compatibles con esta categoría.</p>';
      }
      if (btnLoadMore) btnLoadMore.style.display = 'none';
      return;
    }

    mods.forEach((mod: any) => {
      const card = document.createElement('div');
      card.className = 'mod-card';

      const iconSrc = mod.icon_url || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="%238b5cf6" stroke-width="1.5"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 8v8m-4-4h8"/></svg>';

      card.innerHTML = `
        <img src="${iconSrc}" class="mod-icon" style="width: 56px; height: 56px; object-fit: cover; border-radius: 8px; flex-shrink: 0;" />
        <div style="flex:1; overflow:hidden; padding-right: 10px;">
          <h4 style="margin:0 0 4px 0; font-size:15px; color:#ffffff; font-weight:600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${mod.title}</h4>
          <p style="margin:0; font-size:12px; color:#a1a1aa; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${mod.description || 'Sin descripción disponible.'}</p>
        </div>
      `;

      const actionsDiv = document.createElement('div');
      actionsDiv.style.cssText = 'display: flex; gap: 8px; align-items: center; flex-shrink: 0; z-index: 10;';

      const btnView = document.createElement('button');
      btnView.className = 'btn btn-secondary';
      btnView.style.cssText = 'padding: 6px 12px; font-size: 12px; cursor: pointer;';
      btnView.innerHTML = '👁️ View';

      const btnInstall = document.createElement('button');
      btnInstall.className = 'btn';
      btnInstall.style.cssText = 'padding: 6px 12px; font-size: 12px; cursor: pointer;';
      btnInstall.innerHTML = '⬇️ Install';

      btnView.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[Nocturn Launcher] View clickeado:', mod);

        try {
          await openModModal(mod);
        } catch (error) {
          console.error('Error al abrir los detalles del mod:', error);
          if (modalDesc) modalDesc.innerText = 'No se pudieron cargar los detalles. Revisa la consola.';
        }
      });

      btnInstall.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        try {
          await quickInstallMod(mod);
        } catch (error) {
          console.error('Error al instalar el mod:', error);
          if (statusText) statusText.innerText = 'Error al instalar el mod.';
          alert('No se pudo instalar el mod. Revisa la consola.');
        }
      });

      actionsDiv.appendChild(btnView);
      actionsDiv.appendChild(btnInstall);
      card.appendChild(actionsDiv);
      modsList.appendChild(card);
    });

    if (btnLoadMore) {
      btnLoadMore.style.display = 'block';
      btnLoadMore.innerText = 'Cargar más mods...';
    }
  }

  async function openModModal(mod: any) {
    if (!modModal) {
      console.error('No existe #mod-modal en el HTML. Añade el modal de detalles al index.html.');
      alert('No se encontró el modal de detalles (#mod-modal) en el index.html.');
      return;
    }

    if (!mod || !mod.project_id) {
      console.error('El mod no tiene project_id:', mod);
      alert('No se pudo abrir el mod porque faltan sus datos de identificación.');
      return;
    }

    currentSelectedMod = mod;
    const cleanGameVersion = versionSelect.value.split('-')[0];
    const projectId = mod.project_id;

    if (modalTitle) modalTitle.innerText = mod.title;
    if (modalDownloads) modalDownloads.innerText = `Descargas: ${mod.downloads ? mod.downloads.toLocaleString() : 'N/A'}`;
    if (modalIcon) modalIcon.src = mod.icon_url || '';
    if (modalDesc) modalDesc.innerText = 'Cargando información detallada desde Modrinth...';
    if (modalVersionSelect) modalVersionSelect.innerHTML = '<option>Cargando versiones...</option>';
    modModal.style.display = 'flex';

    const detailedData = await window.electronAPI.getModDetails(projectId);
    if (detailedData && detailedData.body) {
      if (modalDesc) modalDesc.innerText = detailedData.body;
      if (detailedData.downloads && modalDownloads) {
        modalDownloads.innerText = `Descargas: ${detailedData.downloads.toLocaleString()} | Autor: ${detailedData.author || mod.author || 'Desconocido'}`;
      }
    } else if (modalDesc) {
      modalDesc.innerText = mod.description || 'No hay descripción detallada disponible.';
    }

    const versionsResult = await window.electronAPI.getModVersions({
      projectId,
      gameVersion: cleanGameVersion
    });
    currentModVersions = Array.isArray(versionsResult) ? versionsResult : [];

    if (modalVersionSelect) {
      modalVersionSelect.innerHTML = '';
      if (currentModVersions.length === 0) {
        modalVersionSelect.innerHTML = '<option value="">No hay archivos compatibles disponibles</option>';
      } else {
        currentModVersions.forEach((ver: any) => {
          const opt = document.createElement('option');
          opt.value = ver.id;
          opt.innerText = `${ver.version_number} (${ver.name})`;
          modalVersionSelect.appendChild(opt);
        });
      }
    }
  }

  async function quickInstallMod(mod: any) {
    const cleanGameVersion = versionSelect.value.split('-')[0];
    const projectId = mod.project_id;

    if (statusText) statusText.innerText = `Buscando archivo para ${mod.title}...`;
    const versions = await window.electronAPI.getModVersions({ projectId, gameVersion: cleanGameVersion });

    if (!versions || versions.length === 0) {
      alert(`No hay versiones compatibles de ${mod.title} para ${cleanGameVersion}.`);
      if (statusText) statusText.innerText = '';
      return;
    }

    const versionObj = versions[0];
    const primaryFile = versionObj.files.find((f: any) => f.primary) || versionObj.files[0];

    if (statusText) statusText.innerText = `Instalando ${mod.title}...`;
    const res = await window.electronAPI.installModFile({
      downloadUrl: primaryFile.url,
      fileName: primaryFile.filename,
      gameVersion: cleanGameVersion
    });

    if (res.success) {
      alert(`¡Mod ${mod.title} (${versionObj.version_number}) instalado con éxito!`);
      if (statusText) statusText.innerText = 'Mod instalado correctamente.';
    } else {
      alert(`Error al instalar: ${res.error}`);
      if (statusText) statusText.innerText = 'Error en la instalación.';
    }
  }

  modalBtnInstall?.addEventListener('click', async () => {
    if (!currentModVersions || currentModVersions.length === 0) return;
    const selectedVersionId = (modalVersionSelect as HTMLSelectElement).value;
    const versionObj = currentModVersions.find((v: any) => v.id === selectedVersionId) || currentModVersions[0];
    if (!versionObj) return;

    const primaryFile = versionObj.files.find((f: any) => f.primary) || versionObj.files[0];
    const cleanGameVersion = versionSelect.value.split('-')[0];

    if (modalBtnInstall) (modalBtnInstall as HTMLButtonElement).innerText = 'Instalando...';

    const res = await window.electronAPI.installModFile({
      downloadUrl: primaryFile.url,
      fileName: primaryFile.filename,
      gameVersion: cleanGameVersion
    });

    if (res.success) {
      alert(`¡Mod ${currentSelectedMod.title} (${versionObj.version_number}) instalado con éxito!`);
      if (modModal) modModal.style.display = 'none';
    } else {
      alert(`Error al instalar: ${res.error}`);
    }

    if (modalBtnInstall) (modalBtnInstall as HTMLButtonElement).innerText = 'Instalar Versión Seleccionada';
  });

  closeModal?.addEventListener('click', () => {
    if (modModal) modModal.style.display = 'none';
  });

  document.getElementById('close-modal-footer')?.addEventListener('click', () => {
    if (modModal) modModal.style.display = 'none';
  });

  modModal?.addEventListener('click', (e) => {
    if (e.target === modModal) modModal.style.display = 'none';
  });

  window.electronAPI.onDownloadProgress((data: any) => {
    if (statusText) statusText.innerText = data.text;
    if (data.percent !== undefined && progressBar) progressBar.style.width = `${data.percent}%`;
  });

  window.electronAPI.onDownloadError((errText: string) => {
    if (statusText) statusText.innerText = `Error: ${errText}`;
  });

  window.electronAPI.onLaunchDiagnostic((data: any) => {
    const message = typeof data === 'string' ? data : data?.message || 'Se registró un diagnóstico.';
    if (statusText) statusText.innerText = `Diagnóstico: ${message}`;
    console.error('[Nocturn Launcher] Diagnóstico de inicio:', data);
  });

  window.electronAPI.onGameClosed((code: number) => {
    if (statusText) statusText.innerText = `El juego se cerró (Código: ${code})`;
    if (progressContainer) progressContainer.style.display = 'none';
    if (progressBar) progressBar.style.width = '0%';
    if (activeSessionCard) activeSessionCard.style.display = 'none';
    window.electronAPI.stopP2PSession();
  });

  const diagnosticModal = document.getElementById('nocturn-diagnostic-modal');
  const diagnosticTitle = document.getElementById('nocturn-diagnostic-title');
  const diagnosticMessage = document.getElementById('nocturn-diagnostic-message');
  const diagnosticDetails = document.getElementById('nocturn-diagnostic-details') as HTMLPreElement | null;
  const diagnosticSummary = document.getElementById('nocturn-diagnostic-summary');
  const closeDiagnostic = () => {
    if (diagnosticModal) diagnosticModal.style.display = 'none';
  };

  document.getElementById('close-nocturn-diagnostic')?.addEventListener('click', closeDiagnostic);
  document.getElementById('close-nocturn-diagnostic-bottom')?.addEventListener('click', closeDiagnostic);
  diagnosticModal?.addEventListener('click', e => {
    if (e.target === diagnosticModal) closeDiagnostic();
  });

  window.electronAPI.onModIncompatibility((data) => {
    if (diagnosticTitle) diagnosticTitle.textContent = data.title || 'Incompatibilidades de mods detectadas';
    if (diagnosticMessage) diagnosticMessage.textContent = data.message || 'Fabric detectó dependencias faltantes.';
    if (diagnosticDetails) diagnosticDetails.textContent = data.details || 'No se recibió detalle adicional.';

    if (diagnosticSummary) {
      diagnosticSummary.innerHTML = '';
      const lines = (data.details || '')
        .split(/\r?\n/)
        .filter(line => /requires|depends|missing|incompatible|hard_dep_no_candidate|fabricloader/i.test(line))
        .slice(0, 12);

      if (!lines.length) lines.push('Revisá el error completo para ver qué mod o dependencia está fallando.');

      lines.forEach(line => {
        const item = document.createElement('div');
        item.style.cssText = 'padding:9px 11px;border:1px solid #3a2b52;background:#211a2e;border-radius:7px;color:#e5e7eb;font-size:12px;overflow-wrap:anywhere;';
        item.textContent = line.trim();
        diagnosticSummary.appendChild(item);
      });
    }

    if (diagnosticModal) diagnosticModal.style.display = 'flex';
  });

  document.getElementById('copy-nocturn-diagnostic')?.addEventListener('click', async () => {
    const diagnosticText = `${diagnosticTitle?.textContent || 'Diagnóstico Nocturn'}\n${diagnosticMessage?.textContent || ''}\n\n${diagnosticDetails?.textContent || ''}`;
    try {
      await navigator.clipboard.writeText(diagnosticText);
      alert('Diagnóstico copiado.');
    } catch {
      alert('No se pudo copiar automáticamente. Seleccioná el error completo y copialo manualmente.');
    }
  });

  document.getElementById('open-nocturn-logs-from-diagnostic')?.addEventListener('click', async () => {
    try {
      await window.electronAPI.openLaunchLogs();
    } catch (error) {
      alert(`No se pudieron abrir los registros: ${String(error)}`);
    }
  });
});
