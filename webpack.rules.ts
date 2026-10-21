import type { ModuleOptions } from 'webpack';

export const rules: NonNullable<ModuleOptions['rules']> = [
  // Regla para manejar imágenes de forma nativa sin errores de compilación
  {
    test: /\.(png|jpe?g|gif|svg)$/i,
    type: 'asset/resource',
    generator: {
      filename: 'assets/[name][ext]'
    }
  },
  // Regla para TypeScript
  {
    test: /\.tsx?$/,
    exclude: /(node_modules|\.webpack)/,
    use: {
      loader: 'ts-loader',
      options: {
        transpileOnly: true,
      },
    },
  },
];