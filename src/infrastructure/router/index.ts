import { readdirSync } from "fs";
import express, { Router } from "express";
const router: Router = Router();

const PATH_ROUTES = __dirname;

function removeExtension(fileName: string): string {
  const cleanFileName = <string>fileName.split(".").shift();
  return cleanFileName;
}

/**
 *
 * @param file tracks.ts
 */
function loadRouter(file: string): void {
  const name = removeExtension(file);
  import(`./${file}`).then((routerModule) => {
    console.log("cargado", name);
    router.use(`/${name}`, routerModule.router);
  });
}

readdirSync(PATH_ROUTES)
  .filter((file) => {
    const isSourceFile = file.endsWith(".ts") || file.endsWith(".js");
    const isDefinitionFile = file.endsWith(".d.ts");
    const isIndex = file.startsWith("index.");
    return isSourceFile && !isDefinitionFile && !isIndex;
  })
  .forEach((file) => loadRouter(file));

export default router;
