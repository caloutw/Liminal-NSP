import { fileURLToPath } from "node:url";
import path, { dirname } from "node:path";

import http from "node:http";
import { WebSocketServer } from "ws";
import fs from "node:fs";

import mime from 'mime-types';

import { ExJSB } from "exjsb";

//path setting.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

//server setting.
let serverSettings = JSON.parse(fs.readFileSync(path.join(__dirname, "config", "serverSettings.json"), "utf-8"));
let headersSetting = JSON.parse(fs.readFileSync(path.join(__dirname, "config", "headerFile.json"), "utf-8"));
let allowController = JSON.parse(fs.readFileSync(path.join(__dirname, "config", "allowController.json"), "utf-8"));
let typeController = JSON.parse(fs.readFileSync(path.join(__dirname, "config", "typeController.json"), "utf-8"));
let errorPage = JSON.parse(fs.readFileSync(path.join(__dirname, "config", "errorPage.json"), "utf-8"));
let basePath = JSON.parse(fs.readFileSync(path.join(__dirname, "config", "basePath.json")));

/* ===========
    Server
=========== */
const serverHTTP = http.createServer();
const serverWS = new WebSocketServer({ server: serverHTTP });

serverHTTP.on("request", async (req, res) => {
    //本函數只允許GET通過
    if (req.method != "GET") return;

    //判斷人機
    if (!req.headers["user-agent"]) return;

    //定義所有化簡
    const url_PATH = req.url.split("?")[0];
    const url_QUERY_STRING = req.url.split("?")[1] || undefined;
    const url_LAST_PATH = url_PATH.endsWith("/") ? req.url.split("/").at(-2) : req.url.split("/").at(-1);
    const url_ISFILE = (url_LAST_PATH.indexOf(".") > 0) ? true : false;
    const url_ISSLASH = url_PATH.endsWith("/") ? true : false;
    const url_TARGET = (url_ISFILE) ? `src${url_PATH}` : `src${url_PATH}index.html`;
    const url_FILEEXT = url_TARGET.split(".").at(-1) || undefined;
    const url_LASTFILEPOS = url_PATH.split("/").map(v => v.includes(".")).findIndex(v => v == true);
    const url_FIXED = url_PATH.split("/").slice(0, url_LASTFILEPOS == -1 ? url_PATH.split("/").length : url_LASTFILEPOS).join("/");
    const user_IP = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

    //先記錄Log
    log(req.method, url_PATH, user_IP);

    //如果路徑位置超出了第一個檔案索引的位置，則導向
    if (url_PATH.split("/").length - 1 !== url_LASTFILEPOS && url_LASTFILEPOS !== -1) {
        const url_NEW = url_QUERY_STRING ? `${url_FIXED}/?${url_QUERY_STRING}` : `${url_FIXED}/`;

        res.writeHead(301, { ...headersSetting, "Location": url_NEW });
        res.end();
        return;
    }

    //如果結尾不是斜線，且也不是檔案，則導向
    if (!url_ISSLASH && !url_ISFILE) {
        const url_NEW = url_QUERY_STRING ? `${url_PATH}/?${url_QUERY_STRING}` : `${url_PATH}/`;

        res.writeHead(301, { ...headersSetting, "Location": url_NEW });
        res.end();
        return;
    }

    //如果是mjs，且有開啟exjs
    if (serverSettings.exjs && url_FILEEXT == "mjs") {
        //定義send
        const send = {
            code: (code) => {
                codeReturn(code ?? 500, res);
            },
            message: (message) => {
                res.writeHead(200, { ...headersSetting, "Content-Type": "text/plain;charset=utf-8" });
                res.write(message);
            },
            end: () => {
                res.end();
            }
        };
        
        //執行exjs
        const execFile = path.join(basePath.path, url_TARGET);
        //找不到檔案割割
        if(!fs.existsSync(execFile)){
            codeReturn(404, res);
            return;
        }
        const container = new ExJSB(execFile, true);
        await container.initialization(()=>{});
        await container.run((e)=>{console.log(e)}, "main", req, send);
        container.destroy();
        return;
    }

    //先調閱allowController，確認是否為包含的文件檔案
    for (let v of allowController) {
        //修正src目錄不會顯示在網址上
        const v_FIXED = v.replace("src", "");

        //此區域判斷是否為檔案或者資料夾
        if (url_PATH.startsWith(v_FIXED)) {
            fs.readFile(path.join(basePath.path, url_TARGET), (err, data) => {
                if (err?.code == "ENOENT") {
                    codeReturn(404, res);
                    return;
                } else if (err) {
                    codeReturn(500, res);
                    return;
                }

                //回傳
                res.writeHead(200, { ...headersSetting, "Content-Type": mime.contentType(mime.lookup(url_TARGET)) });
                res.end(data);
            });
            return;
        }
    }

    //先調閱typeController，確認是否為包含的文件檔案
    if (Object.keys(typeController).includes(url_FILEEXT)) {
        //查看是否為POST要求
        if (typeController[url_FILEEXT]["POST"] && serverSettings.protect) {
            codeReturn(401, res);
            return;
        }

        //是否需要referer
        if (typeController[url_FILEEXT]["referer"] && !req.headers.referer && serverSettings.protect) {
            codeReturn(401, res);
            return;
        }

        //是否需要cross
        if (typeController[url_FILEEXT]["cross"] && req.headers.origin != req.headers.referer && serverSettings.protect) {
            codeReturn(401, res);
            return;
        }

        //如果都沒問題則讀取檔案
        fs.readFile(path.join(basePath.path, url_TARGET), (err, data) => {
            if (err?.code == "ENOENT") {
                codeReturn(404, res);
                return;
            } else if (err) {
                codeReturn(500, res);
                return;
            }

            //回傳
            res.writeHead(200, { ...headersSetting, "Content-Type": mime.contentType(mime.lookup(url_TARGET)) });
            res.end(data);
        });

        return;
    }

    //如果不是包含的文件檔案，則導向
    codeReturn(401, res);
    return;
});


serverHTTP.on("request", async (req, res) => {
    //本函數只允許POST通過
    if (req.method != "POST") return;

    //判斷人機
    if (!req.headers["user-agent"] && !req.headers["User-Agent"]) return;

    //定義所有化簡
    const url_PATH = req.url.split("?")[0];
    const url_QUERY_STRING = req.url.split("?")[1] || undefined;
    const url_LAST_PATH = url_PATH.endsWith("/") ? req.url.split("/").at(-2) : req.url.split("/").at(-1);
    const url_ISFILE = (url_LAST_PATH.indexOf(".") > 0) ? true : false;
    const url_TARGET = `src${url_PATH}`;
    const url_FILEEXT = url_TARGET.split(".").at(-1) || undefined;
    const user_IP = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

    //轉交body
    req.body = await new Promise(res => {
        let body_content = "";

        req.on('data', (chunk) => {
            body_content += chunk;
            return;
        });

        req.on('end', () => {
            let result_data = (() => {
                try { return JSON.parse(body_content) } catch { return body_content };
            })();

            res(body_content.length > 0 ? result_data : undefined);
            return;
        })
    });

    //先記錄Log
    log(req.method, url_PATH, user_IP);
    
    //如果是mjs，且有開啟exjs
    if (serverSettings.exjs && url_FILEEXT == "mjs") {
        //定義send
        const send = {
            code: (code) => {
                codeReturn(code ?? 500, res);
            },
            message: (message) => {
                res.writeHead(200, { ...headersSetting, "Content-Type": "text/plain;charset=utf-8" });
                res.write(message);
            },
            end: () => {
                res.end();
            }
        };
        
        //執行exjs
        const execFile = path.join(basePath.path, url_TARGET);
        //找不到檔案割割
        if(!fs.existsSync(execFile)){
            codeReturn(404, res);
            return;
        }
        const container = new ExJSB(execFile, true);
        await container.initialization(()=>{});
        await container.run((e)=>{console.log(e)}, "main", req, send);
        container.destroy();
        return;
    }

    //先調閱allowController，確認是否為包含的文件檔案
    for (let v of allowController) {
        //修正src目錄不會顯示在網址上
        const v_FIXED = v.replace("src", "");

        //此區域判斷是否為檔案或者資料夾
        if (url_PATH.startsWith(v_FIXED)) {
            fs.readFile(path.join(basePath.path, url_TARGET), (err, data) => {
                if (err?.code == "ENOENT") {
                    codeReturn(404, res);
                    return;
                } else if (err) {
                    codeReturn(500, res);
                    return;
                }

                //回傳
                res.writeHead(200, { ...headersSetting, "Content-Type": mime.contentType(mime.lookup(url_LAST_PATH)) });
                res.end(data);
            });
            return;
        }
    }

    //先調閱typeController，確認是否為包含的文件檔案
    if (Object.keys(typeController).includes(url_FILEEXT)) {
        //查看是否為POST要求
        if (typeController[url_FILEEXT]["POST"] && serverSettings.protect) {
            codeReturn(401, res);
            return;
        }

        //是否需要referer
        if (typeController[url_FILEEXT]["referer"] && !req.headers.referer && serverSettings.protect) {
            codeReturn(401, res);
            return;
        }

        //是否需要cross
        if (typeController[url_FILEEXT]["cross"] && req.headers.origin != req.headers.referer && serverSettings.protect) {
            codeReturn(401, res);
            return;
        }

        //如果都沒問題則讀取檔案
        fs.readFile(path.join(basePath.path, url_TARGET), async (err, data) => {
            if (err?.code == "ENOENT") {
                codeReturn(404, res);
                return;
            } else if (err) {
                codeReturn(500, res);
                return;
            }

            //回傳
            res.writeHead(200, { ...headersSetting, "Content-Type": mime.contentType(mime.lookup(url_LAST_PATH)) });
            res.end(data);
        });
        return;
    }
});

serverWS.on("connection", (ws) => {
    ws.close();
});

serverHTTP.listen(serverSettings.port, () => {
    console.log(`Server is listening on port ${serverSettings.port}`);
});

serverHTTP.on("error", (e) => {
    if (e.code == "EADDRINUSE") console.error(`Port ${serverSettings.port} is already in use.`);
    else console.error(e);
    process.exit(1);
});
serverWS.on("error", (e) => {
    if (e.code == "EADDRINUSE") console.error(`Port ${serverSettings.port} is already in use.`);
    else console.error(e);
    process.exit(1);
});

/* ===========
    Function
=========== */
async function log(method, url_PATH, user_IP) {
    //現在時間(Unix時間)
    const now = Date.now();

    //LOG 各項設定
    let newLog = `| ${now} | ${method.padEnd(6, " ")} | ${url_PATH.padEnd(20, " ")} | ${user_IP.padEnd(15, " ")} |`;

    //定位位置
    const log_PATH = path.join(basePath.path, "log");

    //檢查資料夾
    if (!fs.existsSync(log_PATH)) fs.mkdirSync(log_PATH);
    //儲存log
    fs.appendFileSync(path.join(log_PATH, "log.txt"), `${newLog}\n`);

    //LOG 輸出
    //debug_log(newLog);
}

async function codeReturn(code, res) {
    res.writeHead(code, { ...headersSetting, "Content-Type": "text/html;charset=utf-8" });

    if (errorPage[code]) res.end(errorPage[code]);
    else res.end();

    return true;
}

/* ===========
    Debug
=========== */
if (serverSettings.debug) {
    (async () => {

    })();
}