const path = require('path');
const { spawn } = require('child_process');

// Path to the built app
const APP_PATH = path.resolve(__dirname, '../../src-tauri/target/release/bundle/macos/MultiAI.app/Contents/MacOS/MultiAI');

let tauriDriver;

exports.config = {
  specs: ['./specs/**/*.js'],
  maxInstances: 1,
  capabilities: [
    {
      'tauri:options': {
        application: APP_PATH,
      },
    },
  ],
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
  reporters: ['spec'],
  logLevel: 'info',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  // WebDriver server URL (tauri-driver runs on 4444)
  hostname: '127.0.0.1',
  port: 4444,

  // Start tauri-driver before tests
  onPrepare: function () {
    return new Promise((resolve, reject) => {
      tauriDriver = spawn('tauri-driver', [], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      tauriDriver.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('[tauri-driver]', output);
        // Wait for driver to be ready
        if (output.includes('listening')) {
          resolve();
        }
      });

      tauriDriver.stderr.on('data', (data) => {
        console.error('[tauri-driver error]', data.toString());
      });

      tauriDriver.on('error', (err) => {
        reject(err);
      });

      // Timeout if driver doesn't start
      setTimeout(() => {
        resolve(); // Continue anyway after 5 seconds
      }, 5000);
    });
  },

  // Stop tauri-driver after tests
  onComplete: function () {
    if (tauriDriver) {
      tauriDriver.kill();
    }
  },
};
