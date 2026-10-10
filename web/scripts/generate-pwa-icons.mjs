import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const source = await fs.readFile(
  new URL("../src/app/icon.svg", import.meta.url),
);
const target = new URL("../public/pwa/", import.meta.url);
await fs.mkdir(target, { recursive: true });
for (const [name, size, fraction] of [
  ["icon-192.png", 192, 0.72],
  ["icon-512.png", 512, 0.72],
  ["icon-maskable-512.png", 512, 0.6],
]) {
  const artwork = await sharp(source)
    .resize(Math.round(size * fraction), Math.round(size * fraction), {
      kernel: "nearest",
    })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: "#faf7f0" },
  })
    .composite([{ input: artwork, gravity: "centre" }])
    .png()
    .toFile(fileURLToPath(new URL(name, target)));
}
await fs.writeFile(
  new URL("../public/offline.html", import.meta.url),
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#faf7f0">
  <title>Meaw is offline</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#faf7f0;color:#151310;font-family:system-ui,sans-serif;min-height:100svh;display:grid;place-items:center;padding:max(24px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left))}
    main{width:100%;max-width:400px}img{width:78px;height:78px;image-rendering:pixelated}h1{font-size:clamp(28px,6vw,36px);font-weight:500;letter-spacing:-.035em;margin:28px 0 12px}p{font-size:16px;line-height:1.65;color:#635e54;margin:0 0 24px}.note{border-top:1px solid #d8d2c7;padding-top:20px;margin-top:32px;font-size:14px}button{min-height:48px;border:0;border-radius:999px;padding:0 24px;background:#151310;color:#fffdf8;font:600 14px system-ui;cursor:pointer}button:focus-visible{outline:2px solid #151310;outline-offset:4px}
  </style>
</head>
<body>
  <main>
    <img src="data:image/svg+xml;base64,${source.toString("base64")}" alt="Meaw the cat" width="78" height="78">
    <h1>You're offline</h1>
    <p>Reconnect to see your balance and continue your payments.</p>
    <button type="button" id="retry">Try again</button>
    <p class="note">Already sent a payment? Check its status in History when you're back online before sending again.</p>
  </main>
  <script>document.getElementById("retry").addEventListener("click",function(){if(location.pathname==="/offline.html"){location.assign("/dashboard")}else{location.reload()}})</script>
</body>
</html>
`,
);
