// Shared build configuration for esbuild
import fs from 'fs';
import path from 'path';

const copyDirectory = (sourceDir, targetDir) => {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const entries = fs.readdirSync(sourceDir);
  for (const entryName of entries) {
    const sourcePath = path.join(sourceDir, entryName);
    const targetPath = path.join(targetDir, entryName);

    const stats = fs.statSync(sourcePath);
    if (stats.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
};

export const createBuildConfig = () => {
  const config = {
    entryPoints: {
      'content-detector': 'src/content-detector.js',
      'content': 'src/content.js',
      'background': 'src/background.js',
      'popup': 'src/popup.js',
      'offscreen': 'src/offscreen.js',
      'styles': 'src/styles.css',
      'print': 'src/print.js',
      'print-page': 'src/print-page.css'
    },
    bundle: true,
    outdir: 'dist',
    format: 'iife', // Use IIFE for Chrome extension content scripts
    target: ['chrome120'], // Target modern Chrome
    treeShaking: true,
    // Define globals
    define: {
      'process.env.NODE_ENV': '"production"',
      'global': 'globalThis', // Polyfill for global
    },
    // Inject Node.js polyfills for browser environment
    inject: ['./scripts/buffer-shim.js'],
    loader: {
      '.css': 'css', // Load CSS files properly to handle @import
      '.woff': 'file',
      '.woff2': 'file',
      '.ttf': 'file',
      '.eot': 'file'
    },
    assetNames: '[name]', // Use original filename without hash
    minify: true,
    sourcemap: false,
    plugins: [
      // Plugin to copy static files and create complete extension
      {
        name: 'create-complete-extension',
        setup(build) {
          build.onEnd(() => {
            try {
              // 1. Copy manifest.json from src/ to dist/
              if (fs.existsSync('src/manifest.json')) {
                fs.copyFileSync('src/manifest.json', 'dist/manifest.json');
                console.log('📄 Copied manifest.json from src/');
              }
              
              // 2. Copy icons to dist/
              if (fs.existsSync('icons')) {
                const iconsDir = 'dist/icons';
                if (!fs.existsSync(iconsDir)) {
                  fs.mkdirSync(iconsDir, { recursive: true });
                }
                const iconFiles = fs.readdirSync('icons');
                for (const iconFile of iconFiles) {
                  fs.copyFileSync(path.join('icons', iconFile), path.join(iconsDir, iconFile));
                }
                console.log('📄 Copied icons/');
              }
              
              // 3. Copy popup HTML files to dist/
              if (fs.existsSync('src/popup.html')) {
                fs.copyFileSync('src/popup.html', 'dist/popup.html');
              }
              
              // 4. Copy offscreen HTML files to dist/
              if (fs.existsSync('src/offscreen.html')) {
                fs.copyFileSync('src/offscreen.html', 'dist/offscreen.html');
              }

              // 5. Copy print HTML files to dist/
              if (fs.existsSync('src/print.html')) {
                fs.copyFileSync('src/print.html', 'dist/print.html');
              }
              
              // 6. Copy JavaScript libraries for offscreen document
              const libFiles = [
                { src: 'node_modules/html2canvas/dist/html2canvas.min.js', dest: 'dist/html2canvas.min.js' }
              ];
              
              for (const { src, dest } of libFiles) {
                if (fs.existsSync(src)) {
                  const destDir = path.dirname(dest);
                  if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true });
                  }
                  fs.copyFileSync(src, dest);
                }
              }
              console.log('📄 Copied JavaScript libraries');

              // 7. Copy locale files for i18n support
              if (fs.existsSync('src/_locales')) {
                copyDirectory('src/_locales', 'dist/_locales');
                console.log('📄 Copied _locales/ directory');
              }
              
              // 6. Fix KaTeX font paths in styles.css
              // esbuild bundles fonts to dist/ root with relative paths like ./KaTeX_*.woff2
              // We convert them to absolute Chrome extension URLs so they work in content scripts
              // __MSG_@@extension_id__ will be resolved by Chrome when CSS is injected
              const stylesCssSource = 'dist/styles.css';
              
              if (fs.existsSync(stylesCssSource)) {
                let stylesContent = fs.readFileSync(stylesCssSource, 'utf8');
                stylesContent = stylesContent.replace(
                  /url\("\.\/KaTeX_([^"]+)"\)/g, 
                  'url("chrome-extension://__MSG_@@extension_id__/KaTeX_$1")'
                );
                fs.writeFileSync(stylesCssSource, stylesContent);
                console.log('📄 Fixed font paths in styles.css');
              }
                            
              console.log('✅ Complete extension created in dist/');
              console.log('🎯 Ready for Chrome: chrome://extensions/ → Load unpacked → select dist/');
            } catch (error) {
              console.error('Error creating complete extension:', error.message);
            }
          });
        }
      }
    ]
  };

  return config;
};
