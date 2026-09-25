import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || 'D:\\Android\\android-sdk';
const platform = join(sdk, 'platforms', 'android-34', 'android.jar');
const tools = join(sdk, 'build-tools', '34.0.0');
const jdk = process.env.JAVA_HOME || 'C:\\Program Files\\Java\\jdk-17';
const out = join(root, 'android', 'build');
const paths = { flat: join(out, 'flat'), generated: join(out, 'generated'), classes: join(out, 'classes'), dex: join(out, 'dex'), unsigned: join(out, 'unsigned.apk'), aligned: join(out, 'aligned.apk'), apk: join(out, 'study-companion-debug.apk'), keystore: join(out, 'debug.keystore') };
function check(exe) { if (!existsSync(exe)) throw new Error('缺少 Android 构建工具：' + exe); }
function run(exe, args, cwd = root) {
  check(exe);
  const result = spawnSync(exe, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk } });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) throw new Error(`${exe} 失败：${result.error?.message || result.status}`);
}
function files(path) { return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]); }
check(platform);
for (const dir of [out, paths.flat, paths.generated, paths.classes, paths.dex]) mkdirSync(dir, { recursive: true });
run(join(jdk, 'bin', 'javac.exe'), ['-version']);
run(process.execPath, [join(root, 'scripts', 'android-assets.mjs')]);
run(join(tools, 'aapt2.exe'), ['compile', '-o', paths.flat, join(root, 'android', 'app', 'src', 'main', 'res', 'drawable', 'ic_study.xml')]);
run(join(tools, 'aapt2.exe'), ['link', '-o', paths.unsigned, '-I', platform, '--manifest', join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), '--java', paths.generated, '-A', join(root, 'android', 'app', 'src', 'main', 'assets'), '--min-sdk-version', '28', '--target-sdk-version', '34', ...files(paths.flat).filter(f => f.endsWith('.flat'))]);
run(join(jdk, 'bin', 'javac.exe'), ['-encoding', 'UTF-8', '-source', '17', '-target', '17', '-cp', platform, '-d', paths.classes, ...files(join(root, 'android', 'app', 'src', 'main', 'java')).filter(f => f.endsWith('.java')), ...files(paths.generated).filter(f => f.endsWith('.java'))]);
run(join(jdk, 'bin', 'java.exe'), ['-cp', join(tools, 'lib', 'd8.jar'), 'com.android.tools.r8.D8', '--min-api', '28', '--lib', platform, '--output', paths.dex, ...files(paths.classes).filter(f => f.endsWith('.class'))]);
run(join(tools, 'aapt.exe'), ['add', paths.unsigned, 'classes.dex'], paths.dex);
// aapt2 on Windows may store nested asset names with backslashes; Android's AssetManager expects '/'.
const archive = await JSZip.loadAsync(readFileSync(paths.unsigned));
for (const name of Object.keys(archive.files).filter(n => n.includes('\\'))) {
  const data = await archive.file(name).async('nodebuffer'); archive.remove(name); archive.file(name.replaceAll('\\', '/'), data);
}
for (const name of ['resources.arsc', 'AndroidManifest.xml']) {
  const data = await archive.file(name)?.async('nodebuffer');
  if (data) archive.file(name, data, { compression: 'STORE' });
}
for (const name of ['assets/index.html', 'assets/app.js', 'assets/tool-views.js', 'assets/workbench.css', 'assets/transport.js', 'assets/sync.js', 'assets/vendor/pdf.mjs', 'assets/vendor/pdf.worker.mjs', 'classes.dex']) {
  if (!archive.file(name)) throw new Error('APK 缺少必须的资源：' + name);
}
writeFileSync(paths.unsigned, await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
run(join(tools, 'zipalign.exe'), ['-f', '4', paths.unsigned, paths.aligned]);
if (!existsSync(paths.keystore)) run(join(jdk, 'bin', 'keytool.exe'), ['-genkeypair', '-keystore', paths.keystore, '-alias', 'study-debug', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '3650', '-storepass', 'android', '-keypass', 'android', '-dname', 'CN=Study Debug,OU=Development,O=Study,C=CN']);
run(join(jdk, 'bin', 'java.exe'), ['-jar', join(tools, 'lib', 'apksigner.jar'), 'sign', '--ks', paths.keystore, '--ks-key-alias', 'study-debug', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', paths.apk, paths.aligned]);
run(join(jdk, 'bin', 'java.exe'), ['-jar', join(tools, 'lib', 'apksigner.jar'), 'verify', '--verbose', paths.apk]);
console.log('Android 调试版 APK：', paths.apk, '字节：', readFileSync(paths.apk).length);
