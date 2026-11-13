import React, { useState, useMemo, useRef } from 'react';
import { History, Download, Upload, Trash2, Calendar, Search, Filter, RefreshCw, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { TradeLog } from '../types';

const formatPrice = (val: number | string | undefined | null): string => {
  if (val === undefined || val === null || val === '') return '--';
  const num = Number(val);
  if (isNaN(num)) return String(val);
  
  let str = num.toString();
  if (str.includes('e')) {
    str = num.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
  }
  
  let digitCount = 0;
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char >= '0' && char <= '9') {
      digitCount++;
    }
    result += char;
    if (digitCount === 10) {
      break;
    }
  }
  if (result.endsWith('.')) {
    result = result.slice(0, -1);
  }
  return result;
};

const parseCsvRows = (text: string): string[][] => {
  const clean = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\r') {
      if (clean[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(c => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      if (row.some(c => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some(c => c !== '')) rows.push(row);
  }
  return rows;
};

const parseTimeMs = (raw?: string): number => {
  if (!raw) return 0;
  const val = raw.trim();
  if (!val || val === '--' || val === '-') return 0;
  if (/^\d{10,13}$/.test(val)) {
    const num = Number(val);
    return val.length <= 10 ? num * 1000 : num;
  }
  const normalized = val.replace(/\//g, '-');
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (match) {
    const [, y, m, d, hh = '00', mm = '00', ss = '00'] = match;
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:${ss.padStart(2, '0')}+08:00`;
    const ts = Date.parse(iso);
    return Number.isFinite(ts) ? ts : 0;
  }
  const ts = Date.parse(val);
  return Number.isFinite(ts) ? ts : 0;
};

const parseNum = (raw?: string): number | undefined => {
  if (raw === undefined || raw === null) return undefined;
  const cleaned = raw.trim().replace(/,/g, '').replace(/[%xX]$/g, '');
  if (!cleaned || cleaned === '--' || cleaned === '-' || cleaned.toUpperCase() === 'N/A') return undefined;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : undefined;
};

const parseTradeLogsFromText = (text: string, fileName: string): Partial<TradeLog>[] => {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return [];

  if (fileName.toLowerCase().endsWith('.json') || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.logs)
      ? parsed.logs
      : Array.isArray(parsed?.tradeLogs)
      ? parsed.tradeLogs
      : null;
    if (!arr) {
      throw new Error('JSON 文件中未找到交易日志数组');
    }
    return arr;
  }

  const rows = parseCsvRows(trimmed);
  if (rows.length === 0) return [];

  const firstRow = rows[0].map(c => c.trim());
  const headerKeywords = ['ID', '合约', '方向', '盈亏', '开仓时间', '状态', 'symbol', 'pnl', 'openTime'];
  const hasHeader = firstRow.some(col => headerKeywords.includes(col) || headerKeywords.includes(col.toLowerCase()));

  const defaultColIndex: Record<string, number> = {
    id: 0,
    symbol: 1,
    direction: 2,
    leverage: 3,
    amount: 4,
    fundingRate: 5,
    amp: 6,
    mValue: 7,
    realA: 8,
    k2: 9,
    entryPrice: 10,
    exitPrice: 11,
    expiryPrice: 12,
    pnl: 13,
    fee: 15,
    profitRate: 16,
    openTime: 17,
    closeTime: 18,
    status: 19
  };

  let colMap: Record<string, number> = { ...defaultColIndex };
  let startIdx = 0;

  if (hasHeader) {
    startIdx = 1;
    colMap = {};
    firstRow.forEach((header, idx) => {
      const h = header.toLowerCase();
      if (h === 'id') colMap.id = idx;
      else if (header === '合约' || h === 'symbol') colMap.symbol = idx;
      else if (header === '方向' || h === 'direction' || h === 'side') colMap.direction = idx;
      else if (header === '杠杆' || h === 'leverage') colMap.leverage = idx;
      else if (header === '数量' || h === 'amount') colMap.amount = idx;
      else if (header.includes('资金费率') || h === 'fundingrate') colMap.fundingRate = idx;
      else if (header === '资金费' || h === 'fundingfee') colMap.fundingFee = idx;
      else if (header === '振幅' || h === 'amp') colMap.amp = idx;
      else if (header === 'M值' || h === 'mvalue') colMap.mValue = idx;
      else if (header === '真实A' || h === 'reala') colMap.realA = idx;
      else if (header === '单K2' || h === 'k2') colMap.k2 = idx;
      else if (header === '开仓价' || h === 'entryprice') colMap.entryPrice = idx;
      else if (header === '平仓价' || h === 'exitprice') colMap.exitPrice = idx;
      else if (header === '到期价格' || h === 'expiryprice') colMap.expiryPrice = idx;
      else if (header === '盈亏' || h === 'pnl') colMap.pnl = idx;
      else if (header === '手续费' || h === 'fee') colMap.fee = idx;
      else if (header === '利润率' || h === 'profitrate') colMap.profitRate = idx;
      else if (header === '开仓时间' || h === 'opentime') colMap.openTime = idx;
      else if (header === '平仓时间' || h === 'closetime') colMap.closeTime = idx;
      else if (header === '状态' || h === 'status') colMap.status = idx;
      else if (header === '策略类型' || h === 'strategytype') colMap.strategyType = idx;
    });
  }

  const getCell = (r: string[], key: string): string => {
    const idx = colMap[key];
    return idx !== undefined && idx >= 0 && idx < r.length ? r[idx] : '';
  };

  const results: Partial<TradeLog>[] = [];
  for (let i = startIdx; i < rows.length; i++) {
    const r = rows[i];
    const id = getCell(r, 'id');
    const symbolRaw = getCell(r, 'symbol');
    const dirRaw = getCell(r, 'direction');
    const statusRaw = getCell(r, 'status');

    const isSkipMark =
      symbolRaw === '[扫跳重置]' ||
      dirRaw === '系统' ||
      statusRaw === '已跳过' ||
      statusRaw.toUpperCase() === 'SKIPPED';

    if (!symbolRaw && !isSkipMark) continue;

    const openTime = parseTimeMs(getCell(r, 'openTime'));
    const closeTime = parseTimeMs(getCell(r, 'closeTime'));

    if (isSkipMark) {
      results.push({
        id: id || undefined,
        symbol: '[扫跳重置]',
        side: 'BUY',
        leverage: 1,
        amount: 0,
        entryPrice: 0,
        exitPrice: 0,
        expiryPrice: 0,
        pnl: 0,
        fee: 0,
        fundingFee: 0,
        profitRate: 0,
        openTime,
        closeTime: closeTime || openTime,
        status: 'SKIPPED',
        isSkipMark: true
      });
      continue;
    }

    let side: 'BUY' | 'SELL' = 'BUY';
    let strategyType = getCell(r, 'strategyType') || undefined;
    if (dirRaw === 'k多') {
      side = 'BUY';
      strategyType = strategyType || 'singleK';
    } else if (dirRaw === 'k空') {
      side = 'SELL';
      strategyType = strategyType || 'singleK';
    } else if (dirRaw === '振多') {
      side = 'BUY';
      strategyType = strategyType || 'amplitude';
    } else if (dirRaw === '振空') {
      side = 'SELL';
      strategyType = strategyType || 'amplitude';
    } else if (/sell|short|空/i.test(dirRaw)) {
      side = 'SELL';
    } else {
      side = 'BUY';
    }

    const fundingRateCell = getCell(r, 'fundingRate');
    const fundingRateParsed = parseNum(fundingRateCell);
    const fundingRate =
      fundingRateParsed !== undefined
        ? (fundingRateCell.includes('%') ? fundingRateParsed / 100 : fundingRateParsed)
        : undefined;

    let status: TradeLog['status'] = 'CLOSED';
    const sUpper = statusRaw.toUpperCase();
    if (statusRaw === '持仓中' || sUpper === 'OPEN') status = 'OPEN';
    else if (statusRaw === '止盈' || sUpper === 'TP') status = 'TP';
    else if (statusRaw === '止损' || sUpper === 'SL') status = 'SL';
    else if (statusRaw === '到期' || sUpper === 'TIMEOUT') status = 'TIMEOUT';
    else if (statusRaw === '追踪' || sUpper === 'TRAILING') status = 'TRAILING';
    else if (statusRaw === '已跳过' || sUpper === 'SKIPPED') status = 'SKIPPED';

    results.push({
      id: id || undefined,
      symbol: symbolRaw.toUpperCase(),
      side,
      leverage: parseNum(getCell(r, 'leverage')) ?? 1,
      amount: parseNum(getCell(r, 'amount')) ?? 0,
      fundingRate,
      amp: parseNum(getCell(r, 'amp')),
      mValue: parseNum(getCell(r, 'mValue')),
      realA: parseNum(getCell(r, 'realA')),
      k2: parseNum(getCell(r, 'k2')),
      entryPrice: parseNum(getCell(r, 'entryPrice')) ?? 0,
      exitPrice: parseNum(getCell(r, 'exitPrice')) ?? 0,
      expiryPrice: parseNum(getCell(r, 'expiryPrice')) ?? 0,
      pnl: parseNum(getCell(r, 'pnl')) ?? 0,
      fee: parseNum(getCell(r, 'fee')) ?? 0,
      fundingFee: parseNum(getCell(r, 'fundingFee')) ?? 0,
      profitRate: parseNum(getCell(r, 'profitRate')) ?? 0,
      openTime,
      closeTime: status === 'OPEN' ? closeTime : (closeTime || openTime),
      status,
      strategyType
    });
  }

  return results;
};

export default function TradeLogs({
  tradeLogs,
  onClear,
  accountId,
  accountName,
  onImportSuccess
}: {
  tradeLogs: TradeLog[];
  onClear: () => void;
  accountId: string;
  accountName?: string;
  onImportSuccess?: (logs: TradeLog[]) => void;
}) {
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportNotice(null);

    try {
      const text = await file.text();
      const parsedLogs = parseTradeLogsFromText(text, file.name);
      if (parsedLogs.length === 0) {
        setImportNotice({ type: 'error', message: '未从文件中解析到有效的交易日志记录，请检查文件内容。' });
        return;
      }

      const res = await fetch(`/api/trade-logs/import?accountId=${accountId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: parsedLogs })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setImportNotice({ type: 'error', message: `导入失败: ${data.message || res.statusText}` });
        return;
      }

      if (onImportSuccess && Array.isArray(data.logs)) {
        onImportSuccess(data.logs);
      }

      setImportNotice({
        type: 'success',
        message: `导入完成：新增 ${data.importedCount} 条历史交易日志${data.skippedCount > 0 ? `，已自动跳过 ${data.skippedCount} 条重复记录` : ''}。`
      });
    } catch (err: any) {
      setImportNotice({ type: 'error', message: `导入失败: ${err?.message || '文件解析异常'}` });
    } finally {
      setIsImporting(false);
      e.target.value = '';
    }
  };

  const handleForceSearch = async () => {
    const isAll = !searchTerm;
    if (isAll && !window.confirm('未输入币种，将尝试同步设置中所有币种的历史成交记录，可能需要较长时间。确定继续吗？')) {
      return;
    }
    
    setIsSyncing(true);
    try {
      const start = startTime ? new Date(startTime).getTime() : undefined;
      const end = endTime ? new Date(endTime).getTime() : undefined;
      
      const res = await fetch(`/api/trade-logs/sync?accountId=${accountId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          symbol: searchTerm ? searchTerm.toUpperCase() : 'ALL', 
          startTime: start, 
          endTime: end 
        })
      });
      
      const data = await res.json();
      if (data.success) {
        alert(`本地搜索完成，共找到 ${data.logs.length} 条成交记录`);
      } else {
        alert('搜索失败: ' + data.message);
      }
    } catch (err: any) {
      alert('请求失败: ' + err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const sortedLogsWithCumPnl = useMemo(() => {
    // 1. 过滤符合条件的日志
    const matched = tradeLogs.filter(log => {
      if (log.accountId && accountId && log.accountId !== accountId) return false;
      const matchesSearch = log.symbol.toLowerCase().includes(searchTerm.toLowerCase());
      const logTime = log.closeTime || log.openTime;
      
      let matchesTime = true;
      if (startTime) {
        const start = new Date(startTime).getTime();
        if (logTime < start) matchesTime = false;
      }
      if (endTime) {
        const end = new Date(endTime).getTime();
        if (logTime > end) matchesTime = false;
      }
      
      return matchesSearch && matchesTime;
    });

    // 2. 正序计算每笔订单平仓后的累计净盈亏 (Sequence Order)
    const closedAsc = matched
      .filter(log => log.status !== 'OPEN')
      .sort((a, b) => {
        const timeA = a.closeTime || a.openTime || 0;
        const timeB = b.closeTime || b.openTime || 0;
        if (timeA !== timeB) return timeA - timeB;
        return String(a.id).localeCompare(String(b.id));
      });

    let runningNetPnl = 0;
    const cumPnlMap = new Map<string, number>();

    for (const log of closedAsc) {
      if (!log.isSkipMark && log.status !== 'SKIPPED' && log.symbol !== '[扫跳重置]') {
        const net = log.pnl - log.fee + (log.fundingFee || 0);
        runningNetPnl += net;
      }
      cumPnlMap.set(String(log.id), runningNetPnl);
    }

    // 3. 将所有记录（包含持仓中的OPEN单）按平仓时间倒序重新排列 (Reverse Display Order)
    return [...matched].sort((a, b) => {
      // 持仓中的OPEN订单优先排在最上方
      if (a.status === 'OPEN' && b.status !== 'OPEN') return -1;
      if (a.status !== 'OPEN' && b.status === 'OPEN') return 1;
      if (a.status === 'OPEN' && b.status === 'OPEN') {
        return b.openTime - a.openTime;
      }

      // 平仓时间越晚（数值越大），排在最前面
      const timeA = a.closeTime || a.openTime || 0;
      const timeB = b.closeTime || b.openTime || 0;
      if (timeA !== timeB) return timeB - timeA;
      return String(b.id).localeCompare(String(a.id));
    }).map(log => ({
      ...log,
      cumPnl: cumPnlMap.get(String(log.id))
    }));
  }, [tradeLogs, searchTerm, startTime, endTime]);

  const filteredLogs = sortedLogsWithCumPnl;

  const totals = useMemo(() => {
    const sums = filteredLogs.reduce((acc, log) => {
      if (log.isSkipMark || log.status === 'SKIPPED' || log.symbol === '[扫跳重置]') return acc;
      return {
        pnl: acc.pnl + log.pnl,
        fee: acc.fee + log.fee,
        fundingFee: acc.fundingFee + (log.fundingFee || 0)
      };
    }, { pnl: 0, fee: 0, fundingFee: 0 });
    
    return {
      ...sums,
      netPnl: sums.pnl - sums.fee + sums.fundingFee
    };
  }, [filteredLogs]);

  // 连赢次数统计逻辑：当遇到亏损订单或扫跳重置标记后，重新计算连赢次数
  const winStreakStats = useMemo(() => {
    const closedLogs = [...tradeLogs]
      .filter(log => (!log.accountId || !accountId || log.accountId === accountId) && (log.status !== 'OPEN' || log.isSkipMark || log.symbol === '[扫跳重置]'))
      .sort((a, b) => (a.closeTime || a.openTime) - (b.closeTime || b.openTime));

    let currentStreak = 0;
    let maxStreak = 0;

    for (const log of closedLogs) {
      if (log.isSkipMark || log.status === 'SKIPPED' || log.symbol === '[扫跳重置]') {
        currentStreak = 0;
        continue;
      }
      const isWin = (log.pnl > 0 || log.profitRate > 0);
      if (isWin) {
        currentStreak++;
        if (currentStreak > maxStreak) {
          maxStreak = currentStreak;
        }
      } else {
        // 订单出现亏损，重置连赢计数
        currentStreak = 0;
      }
    }

    return {
      currentStreak,
      maxStreak,
      totalClosed: closedLogs.filter(log => log.status !== 'OPEN' && log.status !== 'SKIPPED' && !log.isSkipMark && log.symbol !== '[扫跳重置]').length
    };
  }, [tradeLogs]);

  const formatMs = (ts: number) => {
    if (!ts || ts === 0) return '--';
    const date = new Date(ts + 8 * 3600 * 1000);
    return date.toISOString().replace('T', ' ').substring(0, 19);
  };

  const getDirectionText = (log: TradeLog) => {
    const isSingleK = log.strategyType === 'singleK' || log.strategyType === 'KLINE' || (!log.strategyType && log.k2 !== undefined && log.k2 !== null);
    if (isSingleK) {
      return log.side === 'BUY' ? 'k多' : 'k空';
    } else {
      return log.side === 'BUY' ? '振多' : '振空';
    }
  };

  const downloadCSV = () => {
    if (filteredLogs.length === 0) return;
    
    const headers = ['ID', '合约', '方向', '杠杆', '数量', '资金费率(下单)', '振幅', 'M值', '真实A', '单K2', '开仓价', '平仓价', '到期价格', '盈亏', '累计盈亏', '手续费', '利润率', '开仓时间', '平仓时间', '状态'];
    const rows = filteredLogs.map(log => {
      if (log.isSkipMark || log.status === 'SKIPPED' || log.symbol === '[扫跳重置]') {
        return [
          log.id,
          '[扫跳重置]',
          '系统',
          '--',
          '0',
          '--',
          '--',
          '--',
          '--',
          '--',
          '--',
          '0.0000',
          '--',
          '0.0000',
          log.cumPnl !== undefined ? log.cumPnl.toFixed(4) : '--',
          '0.0000',
          '0.00%',
          formatMs(log.openTime),
          formatMs(log.closeTime),
          '已跳过'
        ];
      }
      return [
        log.id,
        log.symbol,
        getDirectionText(log),
        log.leverage + 'x',
        log.amount,
        log.fundingRate !== undefined ? (log.fundingRate * 100).toFixed(4) + '%' : '--',
        log.amp !== undefined ? log.amp.toFixed(2) + '%' : '--',
        log.mValue !== undefined ? log.mValue.toFixed(2) : '--',
        log.realA ? log.realA.toFixed(2) + '%' : '--',
        log.k2 !== undefined && log.k2 !== null ? log.k2.toFixed(2) + '%' : '--',
        formatPrice(log.entryPrice),
        formatPrice(log.exitPrice),
        formatPrice(log.expiryPrice),
        log.pnl.toFixed(4),
        log.cumPnl !== undefined ? log.cumPnl.toFixed(4) : '--',
        log.fee.toFixed(4),
        log.profitRate.toFixed(2) + '%',
        formatMs(log.openTime),
        formatMs(log.closeTime),
        log.status === 'OPEN' ? '持仓中' : 
        log.status === 'TP' ? '止盈' : 
        log.status === 'SL' ? '止损' : 
        log.status === 'TIMEOUT' ? '到期' : 
        log.status === 'TRAILING' ? '追踪' : '已平仓'
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    const rawAccountLabel = (accountName || accountId || '').trim();
    const safeAccountLabel = rawAccountLabel.replace(/[\\/:*?"<>|]/g, '_').trim();
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = safeAccountLabel
      ? `trade_logs_${safeAccountLabel}_${dateStr}.csv`
      : `trade_logs_${dateStr}.csv`;
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <div className="bg-white border border-slate-100 rounded-[1.5rem] p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8">
            <h3 className="text-base font-black text-slate-900 flex items-center gap-2.5">
              <History className="text-indigo-500" size={20} />
              交易日志
            </h3>

            <div className="flex flex-wrap items-center gap-6 border-l border-slate-100 pl-8">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">当前连赢</span>
                <span className="text-sm font-black text-amber-600">
                  {winStreakStats.currentStreak} <span className="text-[10px] font-medium text-slate-400">次</span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">最大连赢</span>
                <span className="text-sm font-black text-indigo-600">
                  {winStreakStats.maxStreak} <span className="text-[10px] font-medium text-slate-400">次</span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">累计盈亏</span>
                <span className={`text-sm font-black ${totals.netPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {totals.netPnl >= 0 ? '+' : ''}{totals.netPnl.toFixed(4)} <span className="text-[10px] font-medium text-slate-400">USDT</span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">累计手续费</span>
                <span className="text-sm font-black text-slate-700">
                  {totals.fee.toFixed(4)} <span className="text-[10px] font-medium text-slate-400">USDT</span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">累计资金费</span>
                <span className={`text-sm font-black ${totals.fundingFee >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {totals.fundingFee >= 0 ? '+' : ''}{totals.fundingFee.toFixed(4)} <span className="text-[10px] font-medium text-slate-400">USDT</span>
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <button 
              onClick={handleForceSearch}
              disabled={isSyncing}
              className={`flex items-center gap-1.5 px-6 py-2 border-2 border-red-500 text-red-500 rounded-lg text-sm font-black uppercase tracking-wider hover:bg-red-50 transition-all active:scale-95 ${isSyncing ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isSyncing ? <RefreshCw size={16} className="animate-spin" /> : null}
              强制搜索
            </button>

            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="搜索币种..." 
                className="pl-9 pr-4 py-2 bg-slate-50 border-none rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500/20 w-40"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="hidden"
              onChange={handleImportFile}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className={`flex items-center gap-1.5 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-indigo-100 transition-all active:scale-95 ${isImporting ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isImporting ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
              {isImporting ? '导入中...' : '导入'}
            </button>
            
            <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-xl border border-slate-100">
              <div className="flex items-center gap-1.5 px-2">
                <Calendar size={12} className="text-slate-400" />
                <input 
                  type="datetime-local" 
                  className="bg-transparent border-none p-1 text-[10px] font-bold text-slate-600 focus:ring-0"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <span className="text-slate-300 text-[10px]">至</span>
              <div className="flex items-center gap-1.5 px-2">
                <input 
                  type="datetime-local" 
                  className="bg-transparent border-none p-1 text-[10px] font-bold text-slate-600 focus:ring-0"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>

            <button 
              onClick={downloadCSV}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-emerald-100 transition-all active:scale-95"
            >
              <Download size={14} />
              导出
            </button>
            
            <button 
              onClick={() => {
                if (window.confirm('确定要清空所有交易日志吗？')) {
                  onClear();
                }
              }}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-50 text-red-600 rounded-xl text-[11px] font-black uppercase tracking-wider hover:bg-red-100 transition-all active:scale-95"
            >
              <Trash2 size={14} />
              清空
            </button>
          </div>
        </div>

        {importNotice && (
          <div
            className={`mb-6 flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs font-bold ${
              importNotice.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            <div className="flex items-center gap-2">
              {importNotice.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              <span>{importNotice.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setImportNotice(null)}
              className="p-1 rounded-lg hover:bg-black/5 transition-colors"
              aria-label="关闭提示"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left table-fixed">
            <thead>
              <tr className="text-[11px] font-medium text-slate-400 uppercase tracking-wider border-b border-slate-50">
                <th className="pb-4 font-normal w-[180px]">合约</th>
                <th className="pb-4 font-normal w-[80px]">方向</th>
                <th className="pb-4 font-normal w-[100px]">资金费率</th>
                <th className="pb-4 font-normal w-[80px]">振幅</th>
                <th className="pb-4 font-normal w-[80px]">M值</th>
                <th className="pb-4 font-normal w-[80px]">真实A</th>
                <th className="pb-4 font-normal w-[80px]">单K2</th>
                <th className="pb-4 font-normal w-[130px]">开仓价</th>
                <th className="pb-4 font-normal w-[130px]">平仓价</th>
                <th className="pb-4 font-normal w-[130px]">到期价格</th>
                <th className="pb-4 font-normal w-[130px]">盈亏(USDT)</th>
                <th className="pb-4 font-normal w-[130px]">累计盈亏(USDT)</th>
                <th className="pb-4 font-normal w-[100px]">利润率</th>
                <th className="pb-4 font-normal w-[120px]">费用</th>
                <th className="pb-4 font-normal w-[100px]">状态</th>
                <th className="pb-4 font-normal w-[180px]">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredLogs.length > 0 ? (
                filteredLogs.map((log) => {
                  if (log.isSkipMark || log.status === 'SKIPPED' || log.symbol === '[扫跳重置]') {
                    return (
                      <tr key={log.id} className="bg-amber-50/40 hover:bg-amber-50/70 transition-colors">
                        <td colSpan={14} className="py-3 px-4">
                          <div className="flex items-center gap-2 text-xs font-bold text-amber-700">
                            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-wider">
                              扫跳重置
                            </span>
                            <span>[系统扫跳策略] 连赢达到预设上限并完成扫跳，连赢计数已在此节点归零重置</span>
                          </div>
                        </td>
                        <td className="py-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-800">
                            已跳过
                          </span>
                        </td>
                        <td className="py-3 font-mono text-[10px] text-slate-400 font-medium">
                          {formatMs(log.closeTime || log.openTime)}
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={log.id} className="group hover:bg-slate-50/50 transition-colors">
                      <td className="py-5 truncate">
                        <div className="font-black text-slate-900 text-sm truncate">{log.symbol}</div>
                        <div className="text-[10px] text-slate-400 font-medium truncate">
                          {log.leverage}x · {log.amount} 
                        </div>
                      </td>
                      <td className="py-5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black ${log.side === 'BUY' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                          {getDirectionText(log)}
                        </span>
                      </td>
                      <td className="py-5 font-mono text-xs font-bold text-slate-500 whitespace-nowrap">
                        {log.fundingRate !== undefined ? (log.fundingRate * 100).toFixed(4) + '%' : '--'}
                      </td>
                      <td className="py-5 font-mono text-xs font-bold text-slate-500 whitespace-nowrap">
                        {log.amp !== undefined ? log.amp.toFixed(2) + '%' : '--'}
                      </td>
                      <td className="py-5 font-mono text-xs font-bold text-slate-500 whitespace-nowrap">
                        {log.mValue !== undefined ? log.mValue.toFixed(2) : '--'}
                      </td>
                      <td className="py-5 font-mono text-xs font-bold text-slate-500 whitespace-nowrap">
                        {log.realA ? log.realA.toFixed(2) + '%' : '--'}
                      </td>
                      <td className="py-5 font-mono text-xs font-bold text-slate-500 whitespace-nowrap">
                        {log.k2 !== undefined && log.k2 !== null ? log.k2.toFixed(2) + '%' : '--'}
                      </td>
                      <td className="py-5 font-mono text-sm font-bold text-slate-700 whitespace-nowrap">
                        {formatPrice(log.entryPrice)}
                      </td>
                      <td className="py-5 font-mono text-sm font-bold text-slate-700 whitespace-nowrap">
                        {formatPrice(log.exitPrice)}
                      </td>
                      <td className={`py-5 font-mono text-sm font-bold whitespace-nowrap ${(() => {
                        if (!log.expiryPrice || log.expiryPrice <= 0) return 'text-slate-400';
                        if (!log.exitPrice || log.exitPrice <= 0) return 'text-indigo-600';
                        const isBuy = log.side === 'BUY' || log.side === 'LONG';
                        const isBetter = isBuy ? (log.expiryPrice > log.exitPrice) : (log.expiryPrice < log.exitPrice);
                        return isBetter ? 'text-red-600' : 'text-emerald-600';
                      })()}`}>
                        {formatPrice(log.expiryPrice)}
                      </td>
                      <td className={`py-5 font-mono text-sm font-bold whitespace-nowrap ${log.pnl > 0 ? 'text-emerald-600' : log.pnl < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                        {log.pnl > 0 ? '+' : ''}{log.pnl.toFixed(4)}
                      </td>
                      <td className={`py-5 font-mono text-sm font-bold whitespace-nowrap ${log.cumPnl === undefined ? 'text-slate-400' : log.cumPnl > 0 ? 'text-emerald-600' : log.cumPnl < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                        {log.cumPnl === undefined ? '--' : `${log.cumPnl >= 0 ? '+' : ''}${log.cumPnl.toFixed(4)}`}
                      </td>
                      <td className={`py-5 font-mono text-sm font-bold whitespace-nowrap ${log.profitRate > 0 ? 'text-emerald-600' : log.profitRate < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                        {log.profitRate > 0 ? '+' : ''}{log.profitRate.toFixed(2)}%
                      </td>
                      <td className="py-5 truncate">
                        <div className="text-[10px] text-slate-500 font-bold truncate">手续费: {log.fee.toFixed(4)}</div>
                        <div className="text-[10px] text-slate-400 font-medium truncate">资金费: {log.fundingFee.toFixed(4)}</div>
                      </td>
                      <td className="py-5">
                        {(() => {
                          let label = '已平仓';
                          let className = 'bg-slate-100 text-slate-400';
                          if (log.status === 'OPEN') {
                            label = '持仓中';
                            className = 'bg-blue-50 text-blue-600';
                          } else if (log.status === 'TP') {
                            label = '止盈';
                            className = 'bg-emerald-50 text-emerald-600';
                          } else if (log.status === 'SL') {
                            label = '止损';
                            className = 'bg-rose-50 text-rose-600';
                          } else if (log.status === 'TIMEOUT') {
                            label = '到期';
                            className = 'bg-amber-50 text-amber-600';
                          } else if (log.status === 'TRAILING') {
                            label = '追踪';
                            className = 'bg-violet-50 text-violet-600';
                          }
                          return (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-black ${className}`}>
                              {label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="py-5 truncate">
                        <div className="text-[10px] text-slate-500 font-bold truncate">开: {formatMs(log.openTime)}</div>
                        <div className="text-[10px] text-slate-400 font-medium truncate">平: {formatMs(log.closeTime)}</div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={15} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center">
                        <Filter size={20} className="text-slate-300" />
                      </div>
                      <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">暂无符合条件的交易日志</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
