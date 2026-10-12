// Build first. Stage a standalone SDK with network-config compiled into the archive.
// No registry publish, wallet access or network transactions.
import { copyFile, mkdir, readFile, readdir, writeFile, mkdtemp } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { npmCliPath } from "./npm-cli.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(root,".release");
await mkdir(releaseDir,{recursive:true});
const stage = await mkdtemp(join(releaseDir,"sdk-stage-"));
await mkdir(join(stage,"dist"));
const sourceManifest = JSON.parse(await readFile(join(root,"packages/sdk/package.json"),"utf8"));
for (const name of await readdir(join(root,"packages/sdk/dist"))) {
  if (name.includes(".test.") || !(name.endsWith(".js") || name.endsWith(".d.ts"))) continue;
  const source = await readFile(join(root,"packages/sdk/dist",name),"utf8");
  await writeFile(join(stage,"dist",name),source.replaceAll('"@agent-commitments/network-config"','"./network-config.js"').replace(/^\/\/# sourceMappingURL=.*$/gm,""));
}
for (const extension of ["js","d.ts"]) {
  const source = await readFile(join(root,`packages/network-config/dist/index.${extension}`),"utf8");
  await writeFile(join(stage,`dist/network-config.${extension}`),source.replace(/^\/\/# sourceMappingURL=.*$/gm,""));
}
await copyFile(join(root,"LICENSE"),join(stage,"LICENSE"));
await copyFile(join(root,"packages/sdk/README.md"),join(stage,"README.md"));
const manifest = {
  name:sourceManifest.name, version:sourceManifest.version, description:"Shared USDC budgets, signed commitments and recovery primitives for Arc builders",
  type:"module", license:"Apache-2.0", engines:{node:">=22"},
  exports:{".":{types:"./dist/index.d.ts",import:"./dist/index.js"}}, types:"./dist/index.d.ts",
  files:["dist","README.md","LICENSE"], dependencies:{viem:sourceManifest.dependencies.viem},
  repository:{type:"git",url:"https://github.com/duclucky/agent-commitments.git",directory:"packages/sdk"},
};
await writeFile(join(stage,"package.json"),JSON.stringify(manifest,null,2)+"\n");
const npmCli = await npmCliPath();
const pack = spawnSync(process.execPath,[npmCli,"pack","--json","--ignore-scripts","--pack-destination",releaseDir],{cwd:stage,encoding:"utf8"});
if (pack.status !== 0) throw new Error(`SDK pack failed: ${pack.stderr}`);
const [archive] = JSON.parse(pack.stdout);
if (archive.files.some(file=>file.path.includes(".test.") || file.path.includes(".map") || file.path.includes(".env"))) throw new Error("Unexpected SDK archive content");
const tarball = join(releaseDir,archive.filename);
const sha256 = createHash("sha256").update(await readFile(tarball)).digest("hex");
await writeFile(join(releaseDir,"sdk-release.json"),JSON.stringify({name:manifest.name,version:manifest.version,filename:archive.filename,sha256,files:archive.files.map(file=>file.path)},null,2)+"\n");
await writeFile(join(releaseDir,"SHA256SUMS"),`${sha256}  ${archive.filename}\n`);
console.log(`Standalone SDK archive: ${archive.filename} (${archive.files.length} allowlisted files)`);
