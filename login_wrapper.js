import { spawn } from 'child_process';
import fs from 'fs';

const child = spawn('npx.cmd', ['firebase-tools', 'login', '--no-localhost'], { shell: true });

let output = '';
let urlFound = false;

child.stdout.on('data', (data) => {
    const str = data.toString();
    output += str;
    
    if (str.includes('Enable Gemini in Firebase features?')) {
        child.stdin.write('n\n');
    }
    if (str.includes('Allow Firebase to collect CLI')) {
        child.stdin.write('n\n');
    }
    
    // Extract URL
    const match = output.match(/(https:\/\/accounts\.google\.com\/o\/oauth2[^\s]+)/);
    if (!urlFound && match) {
        fs.writeFileSync('clean_url.txt', match[1].replace(/\r|\n/g, ''));
        urlFound = true;
    }
});

child.stderr.on('data', (data) => {
    console.error(data.toString());
});

setInterval(() => {
    if (fs.existsSync('auth_code.txt')) {
         const code = fs.readFileSync('auth_code.txt', 'utf8').trim();
         if (code) {
             console.log('Sending auth code...');
             child.stdin.write(code + '\n');
             fs.unlinkSync('auth_code.txt');
         }
    }
}, 2000);

child.on('close', (code) => {
    fs.writeFileSync('login_final.txt', `Exit: ${code}\n${output}`);
    process.exit(code);
});
