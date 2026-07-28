const { spawn } = require('child_process');
const fs = require('fs');

const child = spawn('firebase', ['login', '--no-localhost'], { shell: true });

let output = '';

child.stdout.on('data', (data) => {
    const str = data.toString();
    output += str;
    
    if (str.includes('? Enable Gemini in Firebase features? (Y/n)')) {
        child.stdin.write('n\n');
    }
    if (str.includes('? Allow Firebase to collect CLI and Emulator Suite usage and error reporting information? (Y/n)')) {
        child.stdin.write('n\n');
    }
});

child.stderr.on('data', (data) => {
    output += data.toString();
});

child.on('close', () => {
    fs.writeFileSync('firebase_url.txt', output);
});

// We keep process alive to let it hit the 'Enter authorization code:' stage, 
// wait a few seconds, then kill it.
setTimeout(() => {
    fs.writeFileSync('firebase_url.txt', output);
    child.kill();
    process.exit(0);
}, 10000);
