import express from "express";
import cookieParser from "cookie-parser";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import nodemailer from "nodemailer";
import { StrategyEngine } from "./src/services/strategy";
import { DEFAULT_SETTINGS } from "./src/constants";
import { AppSettings } from "./src/types";
import { dbService } from "./src/services/database";
import { WebSocketServer } from "ws";
import rateLimit from "express-rate-limit";

import CryptoJS from "crypto-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(process.cwd(), "settings.json");
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "supernode-secret-key";

// Settings lock to prevent race conditions during global state updates
class AsyncLock {
  private promise: Promise<void> | null = null;
  async acquire() {
    while (this.promise) await this.promise;
    let release: () => void;
    this.promise = new Promise(resolve => { release = resolve; });
    return () => { this.promise = null; release(); };
  }
}
const settingsLock = new AsyncLock();

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function encrypt(text: string) {
  if (!text) return text;
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

function decrypt(ciphertext: string) {
  if (!ciphertext) return ciphertext;
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    return decrypted || ciphertext;
  } catch (e) {
    return ciphertext;
  }
}

function isObject(item: any): boolean {
  return item && typeof item === 'object' && !Array.isArray(item);
}

function deepMerge(target: any, source: any): any {
  if (!source || typeof source !== 'object') {
    return target;
  }
  const output = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target ? target[key] : undefined;

    if (Array.isArray(sourceVal)) {
      output[key] = sourceVal;
    } else if (isObject(sourceVal)) {
      if (isObject(targetVal)) {
        output[key] = deepMerge(targetVal, sourceVal);
      } else {
        output[key] = sourceVal;
      }
    } else if (sourceVal !== undefined) {
      output[key] = sourceVal;
    }
  }
  return output;
}

function mergeSettings(loaded: any): AppSettings {
  if (!loaded || typeof loaded !== 'object') {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  const defAcc = DEFAULT_SETTINGS.accounts[0];
  let rawAccounts = loaded.accounts;

  // Backward compatibility check for older single-account configuration structure
  if (!Array.isArray(rawAccounts) || rawAccounts.length === 0) {
    if (loaded.binance || loaded.scanner || loaded.order || loaded.withdrawal) {
      rawAccounts = [{
        id: (loaded.id || defAcc.id).toString().trim(),
        name: loaded.name || defAcc.name,
        enabled: loaded.enabled !== undefined ? loaded.enabled : defAcc.enabled,
        isMasterAccount: true,
        initialCumPnl: loaded.initialCumPnl !== undefined ? Number(loaded.initialCumPnl) : 0,
        binance: loaded.binance || defAcc.binance,
        scanner: loaded.scanner || defAcc.scanner,
        order: loaded.order || defAcc.order,
        withdrawal: loaded.withdrawal || defAcc.withdrawal,
      }];
    } else {
      rawAccounts = DEFAULT_SETTINGS.accounts;
    }
  }

  const mergedAccounts = rawAccounts.map((acc: any) => {
    // Perform robust deep merge with default account template
    const mergedAcc = deepMerge(JSON.parse(JSON.stringify(defAcc)), acc);

    // Normalize and clean up specific fields
    mergedAcc.id = (mergedAcc.id || defAcc.id).toString().trim();
    mergedAcc.name = mergedAcc.name || defAcc.name;
    mergedAcc.enabled = mergedAcc.enabled !== undefined ? mergedAcc.enabled : defAcc.enabled;
    mergedAcc.isMasterAccount = mergedAcc.isMasterAccount !== undefined ? mergedAcc.isMasterAccount : (defAcc.isMasterAccount || false);
    mergedAcc.initialCumPnl = mergedAcc.initialCumPnl !== undefined ? Number(mergedAcc.initialCumPnl) : (defAcc.initialCumPnl || 0);

    // Backward-compatible defaults for sub-strategy switches
    const rawConds = acc.scanner?.stage2?.conditions;
    if (mergedAcc.scanner?.stage2?.conditions) {
      if (rawConds?.buyStrategyEnabled === undefined) {
        mergedAcc.scanner.stage2.conditions.buyStrategyEnabled = rawConds?.longShort
          ? rawConds.longShort.buyEnabled !== false
          : true;
      }
      if (rawConds?.sellStrategyEnabled === undefined) {
        mergedAcc.scanner.stage2.conditions.sellStrategyEnabled = rawConds?.longShort
          ? (rawConds.longShort.sellEnabled ?? false)
          : true;
      }
    }
    const rawSingleK = acc.scanner?.stage2?.singleK;
    if (mergedAcc.scanner?.stage2?.singleK) {
      if (rawSingleK?.buyStrategyEnabled === undefined) {
        mergedAcc.scanner.stage2.singleK.buyStrategyEnabled = true;
      }
      if (rawSingleK?.sellStrategyEnabled === undefined) {
        mergedAcc.scanner.stage2.singleK.sellStrategyEnabled = true;
      }
    }

    // Ensure time control 96 slots structure
    const rawTc = acc.scanner?.timeControl || {};
    const baseSlots = Array.isArray(rawTc.slots) && rawTc.slots.length === 96
      ? rawTc.slots
      : (Array.isArray(rawTc.hours) && rawTc.hours.length === 24
          ? rawTc.hours.flatMap((h: boolean) => [h, h, h, h])
          : (defAcc.scanner.timeControl.slots || Array(96).fill(true)));

    const rawWeekSlots = rawTc.weekSlots || {};
    const weekSlots: Record<number, boolean[]> = {};
    [1, 2, 3, 4, 5, 6, 0].forEach(d => {
      if (Array.isArray(rawWeekSlots[d]) && rawWeekSlots[d].length === 96) {
        weekSlots[d] = rawWeekSlots[d];
      } else {
        weekSlots[d] = [...baseSlots];
      }
    });

    mergedAcc.scanner.timeControl = {
      ...defAcc.scanner.timeControl,
      ...rawTc,
      mode: (rawTc.mode === '+8') ? '+2' : (rawTc.mode === '-8' ? '-2' : (rawTc.mode || defAcc.scanner.timeControl.mode)),
      slots: baseSlots,
      weekSlots,
    };

    return mergedAcc;
  });

  const settings: AppSettings = {
    appName: loaded.appName || DEFAULT_SETTINGS.appName,
    accounts: mergedAccounts,
    email: deepMerge(DEFAULT_SETTINGS.email, loaded.email || {}),
    auth: deepMerge(DEFAULT_SETTINGS.auth, loaded.auth || {}),
    remoteControl: deepMerge(DEFAULT_SETTINGS.remoteControl || { enabled: false, secretKey: '', allowedIps: '' }, loaded.remoteControl || {}),
  };
  return settings;
}

async function loadSettings(): Promise<AppSettings> {
  // 1. Try to load from SQLite database first
  try {
    await dbService.init();
    const dbSettings = await dbService.getSettings('app_settings_global');
    if (dbSettings) {
      const merged = mergeSettings(dbSettings);
      console.log(`[Settings] Loaded from SQLite. Accounts: ${merged.accounts.length}`);
      return merged;
    }
  } catch (e: any) {
    console.error("[Settings] DB Load error:", e.message);
  }

  // 2. Fallback to settings.json
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
      const loaded = JSON.parse(data);
      const merged = mergeSettings(loaded);
      console.log(`[Settings] Loaded from JSON. Accounts: ${merged.accounts.length}`);
      return merged;
    } catch (e: any) {
      console.error("[Settings] JSON Load error:", e.message);
    }
  }

  console.log("[Settings] Using defaults.");
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

async function saveGlobalSettings(settings: any) {
  try {
    console.log(`Saving global settings to: ${SETTINGS_FILE} and database.`);
    const settingsToSave = JSON.parse(JSON.stringify(settings));
    
    // Save to file
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settingsToSave, null, 2));
    
    // Save to database
    await dbService.saveSettings(settingsToSave, 'app_settings_global');
    
    console.log("Global settings saved successfully everywhere.");
  } catch (e) {
    console.error("Failed to save global settings", e);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(cookieParser());

  const unlockLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 attempts per 15 minutes
    message: { success: false, message: "尝试次数过多，请 15 分钟后再试。" }
  });

  // Gatekeeper Middleware (门卫功能)
  const GATEKEEPER_KEY = process.env.GATEKEEPER_KEY;
  if (GATEKEEPER_KEY) {
    console.log("Gatekeeper mode enabled. Protecting routes with X-Gatekeeper-Key header or gatekeeper_token cookie.");
    app.use((req, res, next) => {
      // Allow health check, static assets, and unlock endpoint without key
      if (
        req.path === "/api/health" || 
        req.path === "/api/gatekeeper/unlock" || 
        req.path.startsWith("/api/remote/") ||
        req.path.startsWith("/assets/") || 
        req.path === "/favicon.ico"
      ) {
        return next();
      }
      
      const key = req.headers["x-gatekeeper-key"] || req.cookies["gatekeeper_token"];
      if (key === GATEKEEPER_KEY) {
        next();
      } else {
        // Determine if this is a browser request for a page
        const acceptsHtml = req.headers.accept && req.headers.accept.includes("text/html");
        const isApi = req.path.startsWith("/api/");
        
        if (acceptsHtml && !isApi) {
          // For browser requests, show a simple unlock page
          return res.status(403).send(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Gatekeeper Unlock</title>
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f4f7f9; }
                .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 10px 25px rgba(0,0,0,0.05); width: 100%; max-width: 400px; text-align: center; }
                h1 { margin-top: 0; color: #1a202c; font-size: 1.5rem; }
                p { color: #718096; margin-bottom: 2rem; }
                input { width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 0.5rem; margin-bottom: 1rem; box-sizing: border-box; font-size: 1rem; }
                button { width: 100%; padding: 0.75rem; background: #3182ce; color: white; border: none; border-radius: 0.5rem; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.2s; }
                button:hover { background: #2b6cb0; }
                .error { color: #e53e3e; margin-top: 1rem; font-size: 0.875rem; display: none; }
              </style>
            </head>
            <body>
              <div class="card">
                <h1>Gatekeeper</h1>
                <p>请输入访问密钥以解锁应用</p>
                <input type="password" id="keyInput" placeholder="输入密钥..." onkeydown="if(event.key==='Enter') unlock()">
                <button onclick="unlock()">解锁</button>
                <div id="errorMsg" class="error">密钥错误，请重试</div>
              </div>
              <script>
                async function unlock() {
                  const key = document.getElementById('keyInput').value;
                  const res = await fetch('/api/gatekeeper/unlock', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key })
                  });
                  if (res.ok) {
                    window.location.reload();
                  } else {
                    document.getElementById('errorMsg').style.display = 'block';
                  }
                }
              </script>
            </body>
            </html>
          `);
        }

        // Otherwise return JSON for API calls or assets
        res.status(403).json({ 
          success: false, 
          gatekeeper: true,
          message: "Gatekeeper: Access Denied. Please unlock with your key." 
        });
      }
    });
  }

  // Initialize Strategy Engines
  console.log("Initializing Strategy Engines...");
  let bootSettings = await loadSettings();
  
  // Programmatically clear account with ID "2" if present in saved settings
  const origAccountsLength = bootSettings.accounts.length;
  bootSettings.accounts = bootSettings.accounts.filter((acc: any) => acc.id !== "2");
  if (bootSettings.accounts.length !== origAccountsLength) {
    console.log(`[Startup] Removed account ID "2" (${origAccountsLength} -> ${bootSettings.accounts.length})`);
    await saveGlobalSettings(bootSettings);
  }
  
  // MIGRATION: Ensure 3 default accounts exist if currently only "default" is setup
  if (bootSettings.accounts.length === 1 && bootSettings.accounts[0].id === "default") {
    console.log("Migration: Expanding default setup to 3 accounts...");
    const baseAcc = bootSettings.accounts[0];
    
    // Perform deep copy to prevent shared object references in settings
    const acc2 = JSON.parse(JSON.stringify(baseAcc));
    acc2.id = "acc_2";
    acc2.name = "账户2";
    acc2.enabled = true;
    acc2.binance.apiKey = '';
    acc2.binance.secretKey = '';
    
    const acc3 = JSON.parse(JSON.stringify(baseAcc));
    acc3.id = "acc_3";
    acc3.name = "账户3";
    acc3.enabled = true;
    acc3.binance.apiKey = '';
    acc3.binance.secretKey = '';

    bootSettings.accounts = [ baseAcc, acc2, acc3 ];
    await saveGlobalSettings(bootSettings);
  }

  const engines: Map<string, StrategyEngine> = new Map();
  
  const updatePrimaryEngineStatus = (accounts: any[]) => {
    let masterFound = accounts.find(a => a.isMasterAccount);
    let primaryId = masterFound ? masterFound.id : null;
    StrategyEngine.primaryWsEngineId = primaryId;
    console.log(`[System] Primary account initialized to: ${primaryId || 'None (Dynamic Fallback Mode)'}`);
    return primaryId;
  };

  let primaryAccountId = updatePrimaryEngineStatus(bootSettings.accounts);
  
  if (!primaryAccountId && bootSettings.accounts.length > 0) {
    console.log("[System] No master account found. Setting first account as default master.");
    bootSettings.accounts[0].isMasterAccount = true;
    await saveGlobalSettings(bootSettings);
    primaryAccountId = updatePrimaryEngineStatus(bootSettings.accounts);
  }
  
  for (const account of bootSettings.accounts) {
    // Construct individual settings for this engine
    const engineSettings: any = {
      ...account,
      email: bootSettings.email,
      appName: bootSettings.appName,
      auth: bootSettings.auth
    };
    
    const engine = new StrategyEngine(account.id, engineSettings);
    engines.set(account.id, engine);
    
    if (!primaryAccountId) {
      primaryAccountId = account.id;
    }
    console.log(`- Account [${account.id}] (${account.name}) initialized.`);
  }

  // Set up shared data if multiple engines exist
  if (primaryAccountId && engines.size > 1) {
    const primaryEngine = engines.get(primaryAccountId)!;
    for (const [id, engine] of engines.entries()) {
      if (id !== primaryAccountId) {
        engine.setExternalMarketSource({
          getKline: (symbol) => (primaryEngine as any).getCachedKline(symbol),
          getStage0Results: () => (primaryEngine as any).getStage0Results(),
        });
        console.log(`- Account [${id}] set to consume shared market data from [${primaryAccountId}].`);
      }
    }
  }

  // Stagger start for all defined accounts automatically
  (async () => {
    let settingsUpdated = false;
    const accountIds = Array.from(engines.keys());
    for (let i = 0; i < accountIds.length; i++) {
      const accountId = accountIds[i];
      const engine = engines.get(accountId);
      if (engine) {
        const accDef = bootSettings.accounts.find(a => a.id === accountId);
        
        // ONLY start the engine automatically if the account is currently enabled.
        if (accDef && accDef.enabled) {
          console.log(`Starting engine for account [${accountId}] (${i+1}/${accountIds.length})...`);
          engine.start().catch((err: any) => console.error(`[${accountId}] failed to start:`, err));

          // 5 seconds delay before starting the NEXT account
          if (i < accountIds.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        } else {
          console.log(`Account [${accountId}] is disabled. Skipping auto-start.`);
        }
      }
    }
    
    // Save updated enabled states if changed
    if (settingsUpdated) {
      await saveGlobalSettings(bootSettings);
    }
  })();

  const getEngine = (req: express.Request): StrategyEngine | undefined => {
    const accountId = (req.query.accountId as string || req.headers['x-account-id'] as string || '').trim();
    if (accountId && engines.has(accountId)) {
      return engines.get(accountId);
    }
    if (!accountId) {
      if (primaryAccountId && engines.has(primaryAccountId)) {
        return engines.get(primaryAccountId);
      }
      if (engines.size > 0) {
        return engines.values().next().value;
      }
    }
    return undefined;
  };

  // Middleware to ensure selected account engine exists
  const engineMiddleware = (req: any, res: any, next: any) => {
    const engine = getEngine(req);
    if (!engine) {
      if (req.path === '/settings' || req.path === '/api/settings') {
        return next(); // Allow global settings fetch/update without engine
      }
      return res.status(404).json({ success: false, message: "账户不存在或引擎未启动" });
    }
    req.engine = engine;
    next();
  };

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString(), accounts: Array.from(engines.keys()) });
  });

  app.post("/api/gatekeeper/unlock", unlockLimiter, async (req, res) => {
    const { key } = req.body;
    if (key === GATEKEEPER_KEY) {
      res.cookie("gatekeeper_token", key, { 
        maxAge: 30 * 24 * 60 * 60 * 1000, 
        httpOnly: true,
        path: "/"
      });
      
      // Ensure global settings are present, don't use bootSettings which might be stale
      const currentSettings = await loadSettings();
      await saveGlobalSettings(currentSettings);
      
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, message: "密钥错误" });
    }
  });

  app.get("/api/accounts", async (req, res) => {
    try {
      const globalSettings = await loadSettings();
      const accountList = globalSettings.accounts.map(acc => {
        const engine = engines.get(acc.id);
        return {
          id: acc.id,
          name: acc.name,
          enabled: engine ? engine.getSystemStatus().isRunning : false,
          isMasterAccount: acc.isMasterAccount || false
        };
      });
      res.json(accountList);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  function getClientIp(req: express.Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    let ip = forwarded 
      ? (typeof forwarded === 'string' ? forwarded.split(',')[0] : forwarded[0]) 
      : (req.socket.remoteAddress || req.ip || '');
    if (ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }
    return ip.trim();
  }

  async function verifyRemoteAccess(req: express.Request) {
    const clientIp = getClientIp(req);
    const globalSettings = await loadSettings();
    const rc = globalSettings.remoteControl;

    if (!rc || rc.enabled === false) {
      return { allowed: false, status: 403, message: "远程控制 API 未在本地系统中开启", clientIp, globalSettings };
    }

    // Key check
    const requestKey = (
      req.headers['x-remote-control-key'] || 
      req.headers['x-api-key'] || 
      req.body?.key || 
      req.body?.secretKey || 
      req.query?.key || 
      ''
    ).toString().trim();
    
    const targetKey = (rc.secretKey || '').trim();
    if (targetKey && requestKey !== targetKey) {
      return { allowed: false, status: 401, message: "远程控制密钥 (Secret Key) 校验失败", clientIp, globalSettings };
    }

    // IP Whitelist check
    let whitelistStr = (rc.allowedIps || '').trim();
    if (whitelistStr.startsWith('ENC:')) {
      try {
        const DB_SECRET_SALT = process.env.GATEKEEPER_KEY || 'SUPERNODE_2030_DB_AES_SECRET_KEY_SALT_2026';
        const bytes = CryptoJS.AES.decrypt(whitelistStr.slice(4), DB_SECRET_SALT);
        whitelistStr = bytes.toString(CryptoJS.enc.Utf8) || whitelistStr;
      } catch (_) {}
    }
    whitelistStr = whitelistStr.trim();

    if (whitelistStr) {
      const allowedList = whitelistStr.split(/[\n,;，\s]+/).map(i => i.trim()).filter(Boolean);
      if (allowedList.length > 0) {
        const isAllowed = allowedList.some(allowedIp => {
          const lower = allowedIp.toLowerCase();
          if (lower === '*' || lower === '0.0.0.0' || lower === '0.0.0.0/0' || lower === 'all' || lower === 'any' || lower === '*.*.*.*') return true;
          if (allowedIp === clientIp) return true;
          if ((clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost') && (allowedIp === '127.0.0.1' || allowedIp === 'localhost' || allowedIp === '::1')) return true;
          if (allowedIp.endsWith('.*') && clientIp.startsWith(allowedIp.slice(0, -1))) return true;
          if (allowedIp.endsWith('*') && clientIp.startsWith(allowedIp.slice(0, -1))) return true;
          return false;
        });

        if (!isAllowed) {
          return { allowed: false, status: 403, message: `IP 地址未经授权: ${clientIp}，请在控制台 IP 白名单中添加该地址`, clientIp, globalSettings };
        }
      }
    }

    return { allowed: true, status: 200, message: "授权通过", clientIp, globalSettings };
  }

  async function performBatchEngineControl(action: 'start' | 'stop', targetAccountId?: string) {
    const globalSettings = await loadSettings();
    const affectedAccounts: string[] = [];

    for (const [id, engine] of engines.entries()) {
      if (!targetAccountId || id === targetAccountId) {
        if (action === 'start') {
          engine.start().catch((err: any) => console.error(`[BatchStart] Engine ${id} failed:`, err));
        } else {
          engine.stop();
        }
        affectedAccounts.push(id);

        const acc = globalSettings.accounts.find((a: any) => a.id === id);
        if (acc) {
          acc.enabled = (action === 'start');
        }
      }
    }

    await saveGlobalSettings(globalSettings);

    const accountList = globalSettings.accounts.map(acc => {
      const engine = engines.get(acc.id);
      return {
        id: acc.id,
        name: acc.name,
        enabled: engine ? engine.getSystemStatus().isRunning : false,
        isMasterAccount: acc.isMasterAccount || false
      };
    });

    const msg = JSON.stringify({ type: 'accounts_update', data: accountList });
    wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(msg);
      }
    });

    return {
      affectedAccounts,
      isRunning: action === 'start',
      action
    };
  }

  app.post("/api/accounts/batch-control", async (req, res) => {
    try {
      const { action, accountId } = req.body;
      if (action !== 'start' && action !== 'stop') {
        return res.status(400).json({ success: false, message: "无效的操作类型，请输入 start 或 stop" });
      }
      const result = await performBatchEngineControl(action, accountId);
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/remote/batch-control", async (req, res) => {
    try {
      const authResult = await verifyRemoteAccess(req);
      if (!authResult.allowed) {
        return res.status(authResult.status).json({
          success: false,
          message: authResult.message,
          clientIp: authResult.clientIp
        });
      }

      let action: 'start' | 'stop' = 'start';
      if (req.body?.action === 'stop' || req.body?.isRunning === false) {
        action = 'stop';
      } else if (req.body?.action === 'start' || req.body?.isRunning === true) {
        action = 'start';
      } else if (req.body?.action === 'toggle') {
        const anyRunning = Array.from(engines.values()).some(e => e.getSystemStatus().isRunning);
        action = anyRunning ? 'stop' : 'start';
      }

      const accountId = req.body?.accountId;
      const result = await performBatchEngineControl(action, accountId);

      res.json({
        success: true,
        message: action === 'start' ? "成功远程开启策略" : "成功远程关闭策略",
        clientIp: authResult.clientIp,
        timestamp: Date.now(),
        ...result
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.all("/api/remote/status", async (req, res) => {
    try {
      const authResult = await verifyRemoteAccess(req);
      if (!authResult.allowed) {
        return res.status(authResult.status).json({
          success: false,
          message: authResult.message,
          clientIp: authResult.clientIp
        });
      }

      const globalSettings = authResult.globalSettings;
      const accountStatuses = globalSettings.accounts.map(acc => {
        const engine = engines.get(acc.id);
        const status = engine ? engine.getSystemStatus() : { isRunning: false, wsConnected: false, apiConnected: false };
        return {
          id: acc.id,
          name: acc.name,
          isMasterAccount: !!acc.isMasterAccount,
          isRunning: status.isRunning,
          wsConnected: status.wsConnected,
          apiConnected: status.apiConnected,
          lastScanTime: (status as any).lastUpdate || null
        };
      });

      const anyRunning = accountStatuses.some(a => a.isRunning);
      const allRunning = accountStatuses.length > 0 && accountStatuses.every(a => a.isRunning);

      res.json({
        success: true,
        clientIp: authResult.clientIp,
        timestamp: Date.now(),
        summary: {
          totalAccounts: accountStatuses.length,
          anyRunning,
          allRunning,
        },
        accounts: accountStatuses
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/ip", async (req, res) => {
    try {
      const { default: axios } = await import("axios");
      const response = await axios.get("https://api.ipify.org?format=json", { timeout: 5000 });
      res.json(response.data);
    } catch (error: any) {
      console.error("Failed to fetch server IP:", error.message);
      res.json({ ip: "获取失败" });
    }
  });

  app.get("/api/dashboard-all", engineMiddleware, async (req: any, res) => {
    try {
      const engine = req.engine;
      const [status, logs, tradeLogs, transferLogs, balanceLogs, accountData, ip] = await Promise.all([
        Promise.resolve(engine.getSystemStatus()),
        Promise.resolve(engine.getLogs()),
        Promise.resolve(engine.getTradeLogs()),
        Promise.resolve(engine.getTransferLogs()),
        dbService.getBalanceLogs(engine.accountId, 2000),
        Promise.resolve(engine.getAccountData()),
        // Add a small cache or timeout for IP fetch to prevent blocking
        Promise.resolve({ ip: "fetching..." }) 
      ]);

      res.json({
        status,
        logs,
        tradeLogs,
        transferLogs,
        balanceLogs,
        account: accountData,
        ip
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/status", engineMiddleware, (req: any, res) => {
    res.json(req.engine.getSystemStatus());
  });

  app.post("/api/check-status", engineMiddleware, async (req: any, res) => {
    const result = await req.engine.checkApiStatus();
    res.json(result);
  });

  app.post("/api/force-scan", engineMiddleware, async (req: any, res) => {
    const { stage } = req.body;
    await req.engine.forceScan(Number(stage));
    res.json({ success: true });
  });

  app.post("/api/engine/start", engineMiddleware, async (req: any, res) => {
    req.engine.start();
    const globalSettings = await loadSettings();
    const acc = globalSettings.accounts.find((a: any) => a.id === req.engine.accountId);
    if (acc) {
      acc.enabled = true;
      await saveGlobalSettings(globalSettings);
    }
    res.json({ success: true, isRunning: true });
  });

  app.post("/api/engine/stop", engineMiddleware, async (req: any, res) => {
    req.engine.stop();
    const globalSettings = await loadSettings();
    const acc = globalSettings.accounts.find((a: any) => a.id === req.engine.accountId);
    if (acc) {
      acc.enabled = false;
      await saveGlobalSettings(globalSettings);
    }
    res.json({ success: true, isRunning: false });
  });

  app.post("/api/engine/force-close", engineMiddleware, async (req: any, res) => {
    try {
      const { symbol, password } = req.body;
      
      // Verify password (consistent with handleModuleUnlock/handleVerifyPassword in App.tsx)
      if (password !== "Sunbin7857#") {
        return res.status(401).json({ success: false, message: "密码错误" });
      }

      const result = await req.engine.forceClosePosition(symbol);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/logs", engineMiddleware, (req: any, res) => {
    res.json(req.engine.getLogs());
  });

  app.get("/api/logs/search", engineMiddleware, async (req: any, res) => {
    try {
      const { keyword, module, type, startTime, endTime, limit, offset } = req.query;
      const logs = await dbService.searchSystemLogs(
        req.engine.accountId,
        keyword as string,
        module as string,
        type as string,
        startTime ? Number(startTime) : undefined,
        endTime ? Number(endTime) : undefined,
        limit ? Number(limit) : 200,
        offset ? Number(offset) : 0
      );
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/trade-logs", engineMiddleware, (req: any, res) => {
    res.json(req.engine.getTradeLogs());
  });

  app.get("/api/transfer-logs", engineMiddleware, (req: any, res) => {
    res.json(req.engine.getTransferLogs());
  });

  app.get("/api/balance-logs", engineMiddleware, (req: any, res) => {
    res.json(req.engine.getBalanceLogs());
  });

  app.get("/api/balance-logs/search", engineMiddleware, async (req: any, res) => {
    try {
      const { startTime, endTime, onlySnapshot } = req.query;
      const logs = await req.engine.searchBalanceLogs(
        Number(startTime),
        Number(endTime),
        onlySnapshot === 'true'
      );
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.post("/api/logs/clear", engineMiddleware, (req: any, res) => {
    req.engine.clearLogs();
    res.json({ success: true });
  });

  app.post("/api/trade-logs/clear", engineMiddleware, (req: any, res) => {
    req.engine.clearTradeLogs();
    res.json({ success: true });
  });

  app.post("/api/transfer-logs/clear", engineMiddleware, (req: any, res) => {
    req.engine.clearTransferLogs();
    res.json({ success: true });
  });

  app.post("/api/balance-logs/clear", engineMiddleware, (req: any, res) => {
    req.engine.clearBalanceLogs();
    res.json({ success: true });
  });

  app.post("/api/trade-logs/sync", engineMiddleware, async (req: any, res) => {
    try {
      const { symbol, startTime, endTime } = req.body;
      const logs = await req.engine.searchTradeLogsLocally(symbol, startTime, endTime);
      res.json({ success: true, logs });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/trade-logs/import", engineMiddleware, async (req: any, res) => {
    try {
      const { logs } = req.body || {};
      if (!Array.isArray(logs)) {
        return res.status(400).json({ success: false, message: "无效的交易日志数据格式" });
      }
      const result = await req.engine.importTradeLogs(logs);
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/scan-results", engineMiddleware, (req: any, res) => {
    const { stage } = req.query;
    res.json(req.engine.getScanResults(Number(stage)));
  });

  app.get("/api/all-scan-results", engineMiddleware, (req: any, res) => {
    res.json(req.engine.getAllScanResults());
  });

  app.get("/api/settings", engineMiddleware, async (req: any, res) => {
    try {
      const mode = req.query.mode;
      if (mode === 'global' || !req.engine) {
        const globalSettings = await loadSettings();
        return res.json(globalSettings);
      }
      
      res.json(req.engine.getSettings());
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/accounts/add", async (req, res) => {
    const release = await settingsLock.acquire();
    try {
      const globalSettings = await loadSettings();
      const newId = `acc_${Date.now()}`;
      
      console.log(`[Server] LOCKED add account request: ${newId}`);
      
      const template = globalSettings.accounts.length > 0 ? globalSettings.accounts[0] : DEFAULT_SETTINGS.accounts[0];
      
      const newAccount = {
        ...JSON.parse(JSON.stringify(template)),
        id: newId,
        name: `新账户 ${globalSettings.accounts.length + 1}`,
        enabled: true,
        isMasterAccount: globalSettings.accounts.length === 0, // Master only if first account
        binance: { ...template.binance, apiKey: '', secretKey: '', positionModeChecked: false }
      };
      
      globalSettings.accounts.push(newAccount);
      await saveGlobalSettings(globalSettings);
      
      const engine = new StrategyEngine(newId, newAccount);
      engines.set(newId, engine);
      
      if (engines.size > 1) {
        const primaryEngine = engines.values().next().value;
        engine.setExternalMarketSource({
          getKline: (symbol: string) => primaryEngine.getCachedKline(symbol),
          getStage0Results: () => primaryEngine.getStage0Results()
        });
      }
      
      // Delay 5 seconds before starting a newly added account, to be consistent with the 5s staggered rule.
      setTimeout(() => {
        engine.start().catch(err => console.error(`[${newId}] failed to start:`, err));
      }, 5000);
      
      engine.setUpdateCallback((type, data) => {
        const message = JSON.stringify({ accountId: newId, type, data });
        wss.clients.forEach(client => {
          if (client.readyState === 1) {
             // @ts-ignore
            if (client.accountId === newId || !client.accountId) {
               client.send(message);
            }
          }
        });
      });

      release();
      res.json({ success: true, account: newAccount });
    } catch (error: any) {
      if (typeof release === 'function') release();
      console.error("Failed to add account:", error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/account/master", engineMiddleware, async (req: any, res) => {
    const release = await settingsLock.acquire();
    try {
      const targetId = req.engine.accountId;
      const globalSettings = await loadSettings();
      
      // Update config array ensuring only one is master
      globalSettings.accounts.forEach(acc => {
        acc.isMasterAccount = acc.id === targetId;
      });
      await saveGlobalSettings(globalSettings);
      
      // Update global primary ID
      primaryAccountId = updatePrimaryEngineStatus(globalSettings.accounts);
      
      // Update loaded engines' settings
      for (const [id, eng] of engines.entries()) {
        const engSettings = eng.getSettings();
        engSettings.isMasterAccount = id === targetId;
        await eng.updateSettings(engSettings);
      }
      
      release();
      res.json({ success: true });
    } catch (error: any) {
      if (typeof release === 'function') release();
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.delete("/api/accounts/:id", async (req, res) => {
    const release = await settingsLock.acquire();
    try {
      const id = (req.params.id || '').toString().trim();
      if (!id) {
        release();
        return res.status(400).json({ success: false, message: "无效的账户ID" });
      }
      
      console.log(`[Server] INITIATING DELETION for: "${id}"`);
      
      // 1. Stop and remove engine FIRST to prevent background tasks from interfering
      const engine = engines.get(id);
      if (engine) {
        console.log(`[Server] Force stopping engine: ${id}`);
        engine.stop();
        engines.delete(id);
      }

      // Load current settings fresh
      let globalSettings = await loadSettings();
      const initialCount = globalSettings.accounts.length;
      
      if (initialCount <= 1) {
        release();
        return res.status(400).json({ success: false, message: "无法删除最后一个账户" });
      }
      
      // Filter out the account
      const filtered = globalSettings.accounts.filter(acc => acc.id.toString().trim() !== id);
      
      if (filtered.length < initialCount) {
        globalSettings.accounts = filtered;
        
        // PERSIST
        await saveGlobalSettings(globalSettings);
        
        // Recalculate primary account
        primaryAccountId = updatePrimaryEngineStatus(globalSettings.accounts);
        
        // Clear all database records associated with this account
        await dbService.clearAccountData(id);
        
        // Final verification check
        const verifiedSettings = await loadSettings();
        if (verifiedSettings.accounts.find(a => a.id === id)) {
          console.error(`[Server] PERSISTENCE FAILURE: ${id} still in verified list!`);
          // Try to save again if it failed
          await saveGlobalSettings(globalSettings);
        }

        release();
        console.log(`[Server] DELETION OF "${id}" IS FINAL.`);
        return res.json({ success: true, removedId: id });
      } else {
        release();
        return res.status(404).json({ success: false, message: "账户不存在" });
      }
    } catch (error: any) {
      if (typeof release === 'function') release();
      console.error("[Server] Critical error during account deletion:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/account", engineMiddleware, (req: any, res) => {
    res.json(req.engine.getAccountData());
  });

  app.post("/api/account/refresh", engineMiddleware, async (req: any, res) => {
    await req.engine.fetchAccountData();
    res.json({ success: true, account: req.engine.getAccountData() });
  });

  app.post("/api/transfer/to-futures", engineMiddleware, async (req: any, res) => {
    try {
      const { amount } = req.body;
      const result = await req.engine.transferToFutures(amount.toString());
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/transfer/to-spot", engineMiddleware, async (req: any, res) => {
    try {
      const { amount } = req.body;
      const result = await req.engine.transferToSpot(amount.toString());
      res.json({ success: true, result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/test-email", async (req: any, res) => {
    try {
      const engine = getEngine(req);
      const emailSettings = req.body?.email || {};
      
      if (engine) {
        // @ts-ignore
        await engine.sendEmail("测试邮件", "这是一封测试邮件，用于检测邮件发送功能。", undefined, "test", emailSettings);
      } else {
        const host = emailSettings.smtpServer || 'smtp.qq.com';
        const port = Number(emailSettings.smtpPort) || 465;
        const user = emailSettings.sender || '67552827@qq.com';
        const pass = emailSettings.password || 'qoaferkcewigbhbh';
        const to = emailSettings.receiver || 'yyb_cq@outlook.com';

        const transporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass },
          tls: {
            rejectUnauthorized: false
          }
        });

        const senderDisplayName = req.body?.accountName || "量化系统";
        await transporter.sendMail({
          from: `"${senderDisplayName}" <${user}>`,
          to,
          subject: "测试邮件",
          text: "这是一封测试邮件，用于检测邮件发送功能。"
        });
      }

      res.json({ success: true, message: "测试邮件已发送，请检查日志或收件箱。" });
    } catch (error: any) {
      console.error("Test email error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/settings/restore", engineMiddleware, async (req: any, res) => {
    const release = await settingsLock.acquire();
    try {
      console.log("[Server] LOCKED restoring settings to defaults...");
      if (fs.existsSync(SETTINGS_FILE)) {
        fs.unlinkSync(SETTINGS_FILE);
        console.log("Deleted settings.json");
      }
      
      const defaults = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      // Reset current engine's account settings to match first account in defaults
      const accDefaults = defaults.accounts[0];
      const newSettings = {
        ...req.engine.getSettings(),
        binance: accDefaults.binance,
        scanner: accDefaults.scanner,
        order: accDefaults.order,
        withdrawal: accDefaults.withdrawal
      };
      
      await req.engine.updateSettings(newSettings);

      const globalSettings = await loadSettings();
      const accIdx = globalSettings.accounts.findIndex((a: any) => a.id === req.engine.accountId);
      if (accIdx !== -1) {
        globalSettings.accounts[accIdx] = {
          ...globalSettings.accounts[accIdx],
          binance: accDefaults.binance,
          scanner: accDefaults.scanner,
          order: accDefaults.order,
          withdrawal: accDefaults.withdrawal
        };
        await saveGlobalSettings(globalSettings);
      }
      
      release();
      res.json({ success: true, settings: req.engine.getSettings() });
    } catch (error: any) {
      if (typeof release === 'function') release();
      console.error("Failed to restore settings:", error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/settings/backup/export", async (req, res) => {
    try {
      const globalSettings = await loadSettings();
      // Deep clone settings for export
      const exportSettings = JSON.parse(JSON.stringify(globalSettings));

      // Calculate the real-time cumulative PnL for each account and update its initialCumPnl
      if (Array.isArray(exportSettings.accounts)) {
        for (let i = 0; i < exportSettings.accounts.length; i++) {
          let account = exportSettings.accounts[i];
          const accountId = account.id || 'default';
          const engine = engines.get(accountId);

          // Ensure exported parameters reflect the latest persisted settings in SQLite / engine
          const dbAccSettings = await dbService.getSettings(`settings_${accountId}`).catch(() => null);
          const liveAccSettings = engine ? engine.getSettings() : null;
          const latestSource = liveAccSettings || dbAccSettings;
          if (latestSource && typeof latestSource === 'object') {
            const normalizedAcc = mergeSettings({
              accounts: [{
                ...account,
                name: latestSource.name || account.name,
                enabled: latestSource.enabled !== undefined ? latestSource.enabled : account.enabled,
                isMasterAccount: latestSource.isMasterAccount !== undefined ? latestSource.isMasterAccount : account.isMasterAccount,
                initialCumPnl: latestSource.initialCumPnl !== undefined ? Number(latestSource.initialCumPnl) : account.initialCumPnl,
                binance: latestSource.binance || account.binance,
                scanner: latestSource.scanner || account.scanner,
                order: latestSource.order || account.order,
                withdrawal: latestSource.withdrawal || account.withdrawal,
              }]
            }).accounts[0];
            exportSettings.accounts[i] = normalizedAcc;
            account = normalizedAcc;
          }
          
          let dbLogs: any[] = [];
          try {
            dbLogs = await dbService.getAllTradeLogs(accountId);
          } catch (err: any) {
            console.error(`Failed to fetch db trade logs for [${accountId}] during export:`, err.message);
          }
          
          const memoryLogs = engine ? engine.getTradeLogs() : [];
          
          // Deduplicate trade logs
          const logMap = new Map<string, any>();
          for (const log of dbLogs) {
            if (log && log.id) logMap.set(String(log.id), log);
          }
          for (const log of memoryLogs) {
            if (log && log.id) logMap.set(String(log.id), log);
          }
          const allLogs = Array.from(logMap.values());

          // Filter valid closed trades
          const validClosedTrades = allLogs
            .filter(log => log.status !== 'OPEN' && !log.isSkipMark && log.status !== 'SKIPPED' && log.symbol !== '[扫跳重置]')
            .sort((a, b) => {
              const timeA = a.closeTime || a.openTime || 0;
              const timeB = b.closeTime || b.openTime || 0;
              if (timeA !== timeB) return timeA - timeB;
              return String(a.id).localeCompare(String(b.id));
            });

          const baseInitialPnl = typeof account.initialCumPnl === 'number'
            ? account.initialCumPnl
            : parseFloat(account.initialCumPnl || '0') || 0;

          let runningPnl = baseInitialPnl;
          for (const log of validClosedTrades) {
            const net = (Number(log.pnl) || 0) - (Number(log.fee) || 0) + (Number(log.fundingFee) || 0);
            runningPnl += net;
          }

          const currentRealtimeCumPnl = parseFloat(runningPnl.toFixed(4));
          account.initialCumPnl = currentRealtimeCumPnl;
          console.log(`[Backup Export] Account [${accountId}] (${account.name}): Base initialCumPnl=${baseInitialPnl}, Valid closed trades=${validClosedTrades.length}, Exported initialCumPnl=${currentRealtimeCumPnl}`);
        }
      }

      // If root initialCumPnl exists, sync it with primary account
      if (exportSettings.accounts && exportSettings.accounts.length > 0) {
        const primaryAcc = exportSettings.accounts.find((a: any) => a.isMasterAccount) || exportSettings.accounts[0];
        if (primaryAcc) {
          exportSettings.initialCumPnl = primaryAcc.initialCumPnl;
        }
      }

      const rawText = JSON.stringify(exportSettings);
      const encrypted = CryptoJS.AES.encrypt(rawText, ENCRYPTION_KEY).toString();
      res.json({ success: true, ciphertext: encrypted });
    } catch (error: any) {
      console.error("Backup export failed:", error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/settings/backup/import", async (req, res) => {
    const release = await settingsLock.acquire();
    try {
      const { ciphertext } = req.body;
      if (!ciphertext) {
        throw new Error("备份数据为空");
      }
      
      let parsed: any = null;
      try {
        const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
        const decrypted = bytes.toString(CryptoJS.enc.Utf8);
        if (decrypted) {
          parsed = JSON.parse(decrypted);
        }
      } catch (e) {
        // Not AES encrypted or direct JSON backup
      }

      if (!parsed) {
        try {
          parsed = typeof ciphertext === 'string' ? JSON.parse(ciphertext) : ciphertext;
        } catch (e) {
          throw new Error("解密或解析失败，备份文件可能损坏或格式无效");
        }
      }
      
      if (!parsed || typeof parsed !== 'object') {
        throw new Error("备份数据格式不正确");
      }
      
      // Normalize imported backup using mergeSettings to ensure all nested properties & fields are valid
      const normalizedBackup = mergeSettings(parsed);
      const backupAccounts = Array.isArray(normalizedBackup.accounts) ? normalizedBackup.accounts : [];
      
      if (backupAccounts.length === 0) {
        throw new Error("备份文件中未找到任何有效的账户配置");
      }

      // Load the current active global settings
      const currentGlobalSettings = await loadSettings();
      if (!Array.isArray(currentGlobalSettings.accounts)) {
        currentGlobalSettings.accounts = [];
      }

      const existingNames = new Set(
        currentGlobalSettings.accounts.map((a: any) => (a.name || '').trim()).filter(Boolean)
      );

      const newlyAddedAccounts: any[] = [];
      const skippedNames: string[] = [];

      for (const candidate of backupAccounts) {
        const candidateName = (candidate.name || '').trim();
        if (!candidateName) continue;

        if (existingNames.has(candidateName)) {
          skippedNames.push(candidateName);
          console.log(`[Backup Import] Skipped existing account name: "${candidateName}" (preserving current settings)`);
          continue;
        }

        // Add to existing set to avoid duplicate names in the same backup file
        existingNames.add(candidateName);

        // Generate a new unique ID for the newly imported account
        const newId = `acc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        
        const newAccount = {
          ...candidate,
          id: newId,
          name: candidateName,
          enabled: candidate.enabled !== undefined ? candidate.enabled : true,
          // Newly imported accounts are added as follower accounts to protect current master
          isMasterAccount: currentGlobalSettings.accounts.length === 0,
          initialCumPnl: candidate.initialCumPnl !== undefined ? Number(candidate.initialCumPnl) : 0,
        };

        currentGlobalSettings.accounts.push(newAccount);
        newlyAddedAccounts.push(newAccount);
        console.log(`[Backup Import] Prepared new account to import: [${newId}] "${candidateName}"`);
      }

      if (newlyAddedAccounts.length === 0) {
        release();
        return res.json({ 
          success: true, 
          message: `未增加新账户：备份中的账户（${skippedNames.join('、')}）在当前系统中均已存在同名账户，已保留原有全部参数不变。`,
          addedCount: 0,
          skippedCount: skippedNames.length,
          skippedNames,
          settings: currentGlobalSettings
        });
      }

      // Save updated global settings with new accounts added
      await saveGlobalSettings(currentGlobalSettings);

      // Ensure master account exists
      if (!primaryAccountId) {
        primaryAccountId = updatePrimaryEngineStatus(currentGlobalSettings.accounts);
      }

      // Incrementally initialize strategy engines ONLY for the newly added accounts
      for (const account of newlyAddedAccounts) {
        const engineSettings: any = {
          ...account,
          email: currentGlobalSettings.email,
          appName: currentGlobalSettings.appName,
          auth: currentGlobalSettings.auth
        };

        const engine = new StrategyEngine(account.id, engineSettings);
        engines.set(account.id, engine);

        // Persist individual account settings to SQLite
        await dbService.saveSettings(engineSettings, `settings_${account.id}`).catch(err => {
          console.error(`Failed to save account [${account.id}] settings to database during import:`, err);
        });

        // Setup shared data source from master engine if available
        if (primaryAccountId && engines.has(primaryAccountId) && account.id !== primaryAccountId) {
          const primaryEngine = engines.get(primaryAccountId)!;
          engine.setExternalMarketSource({
            getKline: (symbol: string) => (primaryEngine as any).getCachedKline(symbol),
            getStage0Results: () => (primaryEngine as any).getStage0Results(),
          });
          console.log(`- Imported Account [${account.id}] set to consume shared market data from [${primaryAccountId}].`);
        }

        // Set update callback for WebSocket broadcasting
        engine.setUpdateCallback((type, data) => {
          const message = JSON.stringify({ accountId: account.id, type, data });
          wss.clients.forEach(client => {
            if (client.readyState === 1) {
              // @ts-ignore
              if (client.accountId === account.id || !client.accountId) {
                client.send(message);
              }
            }
          });
        });

        // Delay starting slightly if enabled to stagger starts
        if (account.enabled) {
          console.log(`Starting engine for newly imported account [${account.id}] (${account.name})...`);
          setTimeout(() => {
            engine.start().catch((err: any) => console.error(`[${account.id}] failed to start on import:`, err.message));
          }, 1000);
        }

        console.log(`- Account [${account.id}] (${account.name}) imported & initialized with initialCumPnl=${account.initialCumPnl}.`);
      }

      release();

      const addedNames = newlyAddedAccounts.map(a => a.name).join('、');
      const skippedMsg = skippedNames.length > 0 ? `，跳过 ${skippedNames.length} 个同名账户（${skippedNames.join('、')}）` : '';
      const responseMsg = `成功增量导入 ${newlyAddedAccounts.length} 个新账户（${addedNames}）${skippedMsg}。原账户与系统全局参数已完整保留！`;

      res.json({ 
        success: true, 
        message: responseMsg,
        addedCount: newlyAddedAccounts.length,
        skippedCount: skippedNames.length,
        addedNames: newlyAddedAccounts.map(a => a.name),
        skippedNames,
        settings: currentGlobalSettings 
      });
    } catch (error: any) {
      if (typeof release === 'function') release();
      console.error("Backup import failed:", error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/settings", engineMiddleware, async (req: any, res) => {
    const release = await settingsLock.acquire();
    try {
      const settings = req.body;
      const accountId = req.engine ? req.engine.accountId : null;
      console.log(`[Server] LOCKED settings update for [${accountId || 'GLOBAL'}]`);
      
      if (req.engine) {
        await req.engine.updateSettings(settings);
      }
      
      const savedEngineSettings = req.engine ? req.engine.getSettings() : settings;

      // Update global settings set
      const globalSettings = await loadSettings();
      
      // Update global fields if present
      if (settings.appName) globalSettings.appName = settings.appName;
      if (settings.email) globalSettings.email = settings.email;
      if (settings.auth) globalSettings.auth = settings.auth;
      if (settings.remoteControl) globalSettings.remoteControl = settings.remoteControl;
      
      // Update account-specific fields (normalized via engine/mergeSettings so all new & legacy keys persist)
      if (accountId) {
        const accountIdx = globalSettings.accounts.findIndex(acc => acc.id === accountId);
        if (accountIdx !== -1) {
          const normalizedAcc = mergeSettings({
            accounts: [{
              ...globalSettings.accounts[accountIdx],
              name: savedEngineSettings.name || globalSettings.accounts[accountIdx].name,
              initialCumPnl: savedEngineSettings.initialCumPnl !== undefined ? Number(savedEngineSettings.initialCumPnl) : (globalSettings.accounts[accountIdx].initialCumPnl ?? 0),
              isMasterAccount: savedEngineSettings.isMasterAccount !== undefined ? savedEngineSettings.isMasterAccount : (globalSettings.accounts[accountIdx].isMasterAccount ?? false),
              binance: savedEngineSettings.binance || globalSettings.accounts[accountIdx].binance,
              scanner: savedEngineSettings.scanner || globalSettings.accounts[accountIdx].scanner,
              order: savedEngineSettings.order || globalSettings.accounts[accountIdx].order,
              withdrawal: savedEngineSettings.withdrawal || globalSettings.accounts[accountIdx].withdrawal,
              enabled: savedEngineSettings.enabled !== undefined ? savedEngineSettings.enabled : globalSettings.accounts[accountIdx].enabled
            }]
          }).accounts[0];
          globalSettings.accounts[accountIdx] = normalizedAcc;
        }
      }
      
      await saveGlobalSettings(globalSettings);
      
      // Propagate global settings to all strategy engines
      for (const [id, engine] of engines.entries()) {
        const engSettings = engine.getSettings();
        engSettings.email = globalSettings.email;
        engSettings.appName = globalSettings.appName;
        engSettings.auth = globalSettings.auth;
        engSettings.remoteControl = globalSettings.remoteControl;
      }
      
      release();
      console.log(`[Server] UNLOCKED settings update for [${accountId || 'GLOBAL'}]`);
      res.json({ success: true, settings: req.engine ? req.engine.settings : globalSettings });
    } catch (error: any) {
      if (typeof release === 'function') release();
      console.error("Failed to update settings:", error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    const currentSettings = await loadSettings(); // Use fresh settings for login
    if (username === currentSettings.auth.username && password === currentSettings.auth.password) {
      res.json({ success: true, token: "mock-token" });
    } else {
      res.status(401).json({ success: false, message: "账号或密码错误" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Daily Balance Report Sender Function
  async function sendDailyBalanceReport() {
    console.log('[Scheduler] Fetching latest account data for daily report...');
    
    const reportRows: string[] = [];
    let totalSpotAll = 0;
    let totalFuturesAll = 0;
    
    for (const [id, engine] of engines.entries()) {
      try {
        console.log(`[Scheduler] Fetching data for account: ${id}`);
        await engine.fetchAccountData();
        const accountData = engine.getAccountData();
        
        const spot = parseFloat(accountData.spotBalance || '0');
        const futures = parseFloat(accountData.totalBalance || '0');
        const total = spot + futures;
        
        totalSpotAll += spot;
        totalFuturesAll += futures;
        
        const accountName = engine.getSettings().name || `账户 [${id}]`;
        
        reportRows.push(`
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 12px; font-weight: 500; color: #1e293b;">${accountName}</td>
            <td style="padding: 12px; font-family: monospace; color: #475569; text-align: right;">${spot.toFixed(2)}</td>
            <td style="padding: 12px; font-family: monospace; color: #475569; text-align: right;">${futures.toFixed(2)}</td>
            <td style="padding: 12px; font-family: monospace; font-weight: 600; color: #0f172a; text-align: right;">${total.toFixed(2)}</td>
          </tr>
        `);
      } catch (err: any) {
        console.error(`[Scheduler] Error fetching data for account ${id}:`, err.message);
        const engineInstance = engines.get(id);
        const accountName = engineInstance ? engineInstance.getSettings().name : `账户 [${id}]`;
        reportRows.push(`
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 12px; font-weight: 500; color: #1e293b;">${accountName}</td>
            <td colspan="3" style="padding: 12px; color: #ef4444; text-align: center;">获取数据失败: ${err.message}</td>
          </tr>
        `);
      }
    }
    
    const grandTotal = totalSpotAll + totalFuturesAll;
    
    const beijingTimeStr = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(new Date());
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>每日账户资产报告</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; padding: 24px; margin: 0;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.02); overflow: hidden; border: 1px solid #e2e8f0;">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 600; letter-spacing: 0.05em;">每日账户资产报告</h1>
            <p style="color: #94a3b8; margin: 8px 0 0 0; font-size: 14px;">报告生成时间: ${beijingTimeStr} (北京时间)</p>
          </div>
          
          <!-- Content Body -->
          <div style="padding: 24px;">
            <!-- Overall Stats Card -->
            <div style="background-color: #f1f5f9; border-radius: 8px; padding: 16px; margin-bottom: 24px; display: flex; justify-content: space-around; border: 1px solid #e2e8f0;">
              <div style="text-align: center; width: 33.33%;">
                <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; margin-bottom: 4px;">总现货资产</div>
                <div style="font-family: monospace; font-size: 15px; font-weight: 700; color: #334155;">${totalSpotAll.toFixed(2)}</div>
              </div>
              <div style="text-align: center; width: 33.33%; border-left: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1;">
                <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; margin-bottom: 4px;">总合约资产</div>
                <div style="font-family: monospace; font-size: 15px; font-weight: 700; color: #334155;">${totalFuturesAll.toFixed(2)}</div>
              </div>
              <div style="text-align: center; width: 33.33%;">
                <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; margin-bottom: 4px;">合并总资产</div>
                <div style="font-family: monospace; font-size: 15px; font-weight: 700; color: #0f172a;">${grandTotal.toFixed(2)}</div>
              </div>
            </div>
            
            <!-- Detailed Table -->
            <h2 style="font-size: 15px; font-weight: 600; color: #334155; margin: 0 0 12px 0;">账户明细列表</h2>
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
              <thead>
                <tr style="background-color: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                  <th style="padding: 10px 12px; font-weight: 600; color: #475569;">账户名称</th>
                  <th style="padding: 10px 12px; font-weight: 600; color: #475569; text-align: right;">现货余额</th>
                  <th style="padding: 10px 12px; font-weight: 600; color: #475569; text-align: right;">合约余额</th>
                  <th style="padding: 10px 12px; font-weight: 600; color: #475569; text-align: right;">合并资产</th>
                </tr>
              </thead>
              <tbody>
                ${reportRows.join('')}
                <tr style="background-color: #f8fafc; font-weight: 600; border-top: 2px solid #cbd5e1;">
                  <td style="padding: 12px; color: #0f172a;">总计</td>
                  <td style="padding: 12px; font-family: monospace; color: #0f172a; text-align: right;">${totalSpotAll.toFixed(2)}</td>
                  <td style="padding: 12px; font-family: monospace; color: #0f172a; text-align: right;">${totalFuturesAll.toFixed(2)}</td>
                  <td style="padding: 12px; font-family: monospace; color: #0f172a; text-align: right; font-size: 14px;">${grandTotal.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <!-- Footer -->
          <div style="background-color: #f8fafc; padding: 16px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8;">
            此邮件由系统自动发送，请勿直接回复。<br>
            © ${new Date().getFullYear()} 量化策略管理系统. All rights reserved.
          </div>
        </div>
      </body>
      </html>
    `;
    
    let senderEngine = engines.get(primaryAccountId || "");
    if (!senderEngine && engines.size > 0) {
      senderEngine = engines.values().next().value;
    }
    
    if (senderEngine) {
      const textContent = `每日账户资产报告\n\n` + 
        `报告生成时间: ${beijingTimeStr} (北京时间)\n` +
        `合并总资产: ${grandTotal.toFixed(2)}\n` +
        `总现货资产: ${totalSpotAll.toFixed(2)}\n` +
        `总合约资产: ${totalFuturesAll.toFixed(2)}\n`;
        
      await senderEngine.sendEmail(`[每日资产报告] ${beijingTimeStr.split(' ')[0]}`, textContent, htmlContent);
      console.log(`[Scheduler] Daily balance report email sent successfully at ${beijingTimeStr}`);
    } else {
      console.error('[Scheduler] No engine found to send daily report email.');
    }
  }

  // API to manually trigger the daily report for testing
  app.post("/api/test-daily-report", async (req, res) => {
    try {
      await sendDailyBalanceReport();
      res.json({ success: true, message: "每日资产报告已成功手动触发发送！请检查收件箱。" });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);

    // Start Daily Balance Report Scheduler at 8:20 AM Beijing Time (UTC+8)
    let lastSentReportDate = "";
    setInterval(async () => {
      try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('zh-CN', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
        const parts = formatter.formatToParts(now);
        const year = parts.find(p => p.type === 'year')?.value || '';
        const month = parts.find(p => p.type === 'month')?.value || '';
        const day = parts.find(p => p.type === 'day')?.value || '';
        const hour = parts.find(p => p.type === 'hour')?.value || '';
        const minute = parts.find(p => p.type === 'minute')?.value || '';
        
        const dateKey = `${year}-${month}-${day}`;
        const hourNum = parseInt(hour, 10);
        const minuteNum = parseInt(minute, 10);
        
        // Target time is 8:20 AM Beijing Time
        const isTargetTime = (hourNum === 8 && minuteNum >= 20) || (hourNum > 8);
        
        if (isTargetTime && lastSentReportDate !== dateKey) {
          console.log(`[Scheduler] Triggering daily balance report for date: ${dateKey}`);
          lastSentReportDate = dateKey;
          await sendDailyBalanceReport();
        }
      } catch (err: any) {
        console.error('[Scheduler] Error in daily balance report check:', err.message);
      }
    }, 30000); // Check every 30 seconds
    console.log('[Scheduler] Daily balance report scheduler started (Target: 08:20 Beijing Time)');
  });

  // WebSocket Server for real-time updates
  const wss = new WebSocketServer({ server });
  
  for (const [id, engine] of engines.entries()) {
    engine.setUpdateCallback((type, data) => {
      const message = JSON.stringify({ accountId: id, type, data });
      wss.clients.forEach(client => {
        if (client.readyState === 1) { // 1 is OPEN
           // @ts-ignore - custom property on ws
          if (client.accountId === id || !client.accountId) {
             client.send(message);
          }
        }
      });
    });
  }

  wss.on('connection', (ws: any, req) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const accountId = url.searchParams.get('accountId') || primaryAccountId;
    ws.accountId = accountId;

    console.log(`New client connected to UI WebSocket for account: ${accountId}`);
    
    const engine = engines.get(accountId || '');
    if (engine) {
      ws.send(JSON.stringify({ accountId, type: 'status', data: engine.getSystemStatus() }));
      ws.send(JSON.stringify({ accountId, type: 'logs', data: engine.getLogs() }));
    }
  });
}

startServer();
