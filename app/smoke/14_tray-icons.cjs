const assert = require("node:assert/strict");
const path = require("node:path");
const { app, nativeImage, Tray } = require("electron");

app.whenReady().then(() => {
  let tray;
  try {
    const directory = path.resolve(process.argv[2]);
    const results = [];
    for (const name of ["tray-gray", "tray-green", "tray-red"]) {
      const image = nativeImage.createFromPath(path.join(directory, `${name}.ico`));
      assert.equal(image.isEmpty(), false, `${name} must load in Electron`);
      const pixels = image.toBitmap();
      assert.ok(pixels.some((value, index) => index % 4 === 3 && value > 0), `${name} must have visible pixels`);
      if (tray) tray.setImage(image);
      else tray = new Tray(image);
      results.push({ name, size: image.getSize() });
    }
    console.log(JSON.stringify({ result: "PASS", directory, icons: results }));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    tray?.destroy();
    app.quit();
  }
});