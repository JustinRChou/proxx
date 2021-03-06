const ejs = require("ejs");
const fs = require("fs");
const puppeteer = require("puppeteer");
const ecstatic = require("ecstatic");
const http = require("http");
const path = require("path");
const CharacterSet = require("characterset");

function findChunkWithName(dependencygraph, name) {
  return Object.values(dependencygraph).find(desc =>
    (desc.facadeModuleId || "").endsWith(name)
  );
}

function findAssetWithName(dependencygraph, name) {
  const parsedName = path.parse(name);

  return Object.values(dependencygraph).find(desc => {
    if (!desc.isAsset) return false;
    const parsedGraphName = path.parse(desc.fileName);
    if (parsedGraphName.ext !== parsedName.ext) return false;
    if (!parsedGraphName.name.startsWith(parsedName.name)) return false;
    const expectedHash = parsedGraphName.name.slice(parsedName.name.length);
    return /^-[0-9a-f]+$/.test(expectedHash);
  });
}

async function renderEjsFile(inPath, outPath, data) {
  const template = fs.readFileSync(inPath).toString();
  const output = ejs.render(template, data);
  fs.writeFileSync(outPath, output);
}

async function generateShell(file, dependencygraph) {
  const normalCharSet = new CharacterSet(
    "PROXXDifficultyHardEasyMediumCustomWidthHeightBlackholes 0123456789"
  );
  // This has to include a space, else Firefox gets confused.
  const boldCharSet = new CharacterSet("START ");

  await renderEjsFile("src/index.ejs", file, {
    bootstrapFile: findChunkWithName(dependencygraph, "bootstrap.tsx").fileName,
    workerFile: findChunkWithName(dependencygraph, "worker.ts").fileName,
    fonts: [
      {
        asset: findAssetWithName(dependencygraph, "space-mono-normal.woff2")
          .fileName,
        weight: 400,
        inline: fs
          .readFileSync("src/assets/space-mono-inline.woff2")
          .toString("base64"),
        inlineRange: normalCharSet.toHexRangeString()
      },
      {
        asset: findAssetWithName(dependencygraph, "space-mono-bold.woff2")
          .fileName,
        weight: 700,
        inline: fs
          .readFileSync("src/assets/space-mono-bold-inline.woff2")
          .toString("base64"),
        inlineRange: boldCharSet.toHexRangeString()
      }
    ],
    nebulaSafeDark: require("./nebula-safe-dark").hex,
    favicon: findAssetWithName(dependencygraph, "favicon.png").fileName,
    dependencygraph,
    icon: findAssetWithName(dependencygraph, "icon-maskable.png").fileName,
    dependencygraph,
    pkg: require("../package.json"),
    fs,
    title: "PROXX — a game",
    description:
      "Help your crew navigate space by marking out the black holes using proxx, your proximity scanner.",
    image_url: `https://proxx.app/${
      findAssetWithName(dependencygraph, "social-cover.jpg").fileName
    }`,
    image_alt: "Game screen of the PROXX game",
    image_width: "1200",
    image_height: "675",
    image_type: "image/jpeg",
    twitter_account: "@chromiumdev",
    url: "https://proxx.app/",
    locale: "en_US"
  });
}

async function startServer() {
  const app = ecstatic({
    root: "./dist"
  });
  return http.createServer(app).listen();
}

async function grabMarkup(address) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  // TODO Is this good?
  page.viewport(1280, 720);
  await page.goto(address);
  await page.waitFor(1000);
  // Set all input field values as an attribute
  await page.evaluate(() => {
    document.querySelectorAll("input").forEach(el => {
      el.setAttribute("value", el.value);
    });
  });
  const markup = await page.evaluate(() => document.documentElement.outerHTML);
  await browser.close();
  return "<!doctype html>" + markup;
}

async function correctMarkup(markup, { port }) {
  // Make absolute references relative
  markup = markup.replace(new RegExp(`http://localhost:${port}/`, "g"), "./");
  // Remove all dynamically added script tags
  markup = markup.replace(
    /<script src="\.\/chunk-([^"]+)"[^>]+><\/script>/g,
    ""
  );
  // Remove all inject style calls (as they're already added)
  markup = markup.replace(/\w+\.styleInject\((["']).*?\1\);/g, "");
  return markup;
}

async function run() {
  const dependencygraph = require("./dependencygraph.json");
  await generateShell("dist/index.html", dependencygraph);
  const server = await startServer();
  const port = server.address().port;
  let markup = await grabMarkup(`http://localhost:${port}/?prerender`);
  markup = await correctMarkup(markup, {
    port
  });
  fs.writeFileSync("dist/index.html", markup);
  server.close();

  await renderEjsFile("src/_headers.ejs", "dist/_headers", {});
}
run();
