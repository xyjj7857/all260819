import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { 
  LineChart as ChartIcon, 
  Download, 
  TrendingUp, 
  ArrowLeftRight, 
  Trash2, 
  Calendar, 
  Search, 
  RefreshCw, 
  Save, 
  DollarSign,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronsRight,
  MoveHorizontal,
  RotateCcw,
  SlidersHorizontal
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine,
  Label,
  Brush
} from 'recharts';
import { TradeLog } from '../types';

interface BalanceLog {
  id: string;
  totalBalance: number;
  timestamp: number;
  spotBalance?: number;
}

interface TransferLog {
  id: string;
  asset: string;
  amount: number;
  type: 'IN' | 'OUT';
  status: 'SUCCESS' | 'FAILED';
  timestamp: number;
  message?: string;
}

function CandlestickChart({ 
  data, 
  transfers = [], 
  height = 420 
}: { 
  data: any[], 
  transfers?: any[], 
  width?: number, 
  height?: number 
}) {
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = React.useState({ x: 0, y: 0 });
  const [candleWidth, setCandleWidth] = React.useState<number>(36);
  const [zoomMode, setZoomMode] = React.useState<'fit' | 'custom'>('custom');
  
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [dragStartX, setDragStartX] = React.useState(0);
  const [dragScrollStart, setDragScrollStart] = React.useState(0);
  const [containerWidth, setContainerWidth] = React.useState<number>(900);

  // Measure container width dynamically
  React.useEffect(() => {
    if (!scrollContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });
    observer.observe(scrollContainerRef.current);
    return () => observer.disconnect();
  }, []);

  // Auto scroll to rightmost (latest) on data update, period change or initial render
  const scrollToLatest = React.useCallback((smooth = true) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        left: scrollContainerRef.current.scrollWidth,
        behavior: smooth ? 'smooth' : 'auto'
      });
    }
  }, []);

  React.useEffect(() => {
    if (data.length > 0) {
      const timer = setTimeout(() => {
        scrollToLatest(false);
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [data.length, zoomMode, candleWidth, scrollToLatest]);

  const paddingLeft = 75;
  const paddingRight = 45;
  const paddingTop = 28;
  const paddingBottom = 46;

  if (data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400 font-bold">
        暂无K线数据
      </div>
    );
  }

  // Calculate cell width based on zoomMode
  const availableChartWidth = Math.max(containerWidth - paddingLeft - paddingRight, 100);
  const cellWidth = zoomMode === 'fit' 
    ? Math.max(availableChartWidth / Math.max(data.length, 1), 8) 
    : candleWidth;

  const totalSvgWidth = Math.max(containerWidth, paddingLeft + data.length * cellWidth + paddingRight);
  const chartHeight = height - paddingTop - paddingBottom;

  // Get min and max across all candles
  const highs = data.map(d => d.high);
  const lows = data.map(d => d.low);
  const absMax = Math.max(...highs);
  const absMin = Math.min(...lows);
  const range = absMax - absMin;
  const padding = range * 0.12 || 10;
  
  const yMin = absMin - padding;
  const yMax = absMax + padding;

  const mapY = (val: number) => {
    if (yMax === yMin) return paddingTop + chartHeight / 2;
    return paddingTop + chartHeight - ((val - yMin) / (yMax - yMin)) * chartHeight;
  };

  const bodyWidth = Math.min(Math.max(cellWidth * 0.55, 3), 44);

  // Generate 4 evenly spaced ticks
  const yTicks = [
    yMin,
    yMin + (yMax - yMin) * 0.333,
    yMin + (yMax - yMin) * 0.666,
    yMax
  ];

  const formatXLabel = (timeStr: string) => {
    if (!timeStr) return '';
    if (timeStr.length > 12) {
      return timeStr.substring(5);
    }
    return timeStr;
  };

  // Smart label thinning to completely prevent X-axis text overlapping
  const minLabelWidth = 72;
  const labelInterval = Math.max(1, Math.ceil(minLabelWidth / cellWidth));

  // Mouse drag handlers for smooth panning
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return;
    setIsDragging(true);
    setDragStartX(e.pageX - scrollContainerRef.current.offsetLeft);
    setDragScrollStart(scrollContainerRef.current.scrollLeft);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollContainerRef.current.offsetLeft;
    const walk = (x - dragStartX) * 1.5;
    scrollContainerRef.current.scrollLeft = dragScrollStart - walk;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleZoomIn = () => {
    setZoomMode('custom');
    setCandleWidth(prev => Math.min(prev + 8, 72));
  };

  const handleZoomOut = () => {
    setZoomMode('custom');
    setCandleWidth(prev => Math.max(prev - 6, 12));
  };

  const handleFitAll = () => {
    setZoomMode('fit');
  };

  const handleResetZoom = () => {
    setZoomMode('custom');
    setCandleWidth(36);
    setTimeout(() => scrollToLatest(true), 50);
  };

  return (
    <div className="space-y-3">
      {/* Top Interactive Zoom Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200/80 px-4 py-2.5 rounded-2xl">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <SlidersHorizontal size={14} className="text-emerald-500" />
            视图缩放:
          </span>
          <div className="flex items-center bg-white border border-slate-200 rounded-xl p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all cursor-pointer"
              title="缩小 (展示更多周期)"
            >
              <ZoomOut size={15} />
            </button>
            <button
              type="button"
              onClick={handleFitAll}
              className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                zoomMode === 'fit' ? 'bg-emerald-50 text-emerald-600 font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
              title="自适应全部展示"
            >
              全部
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                zoomMode === 'custom' && candleWidth === 36 ? 'bg-emerald-50 text-emerald-600 font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
              title="恢复默认 100% 比例"
            >
              100%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all cursor-pointer"
              title="放大 (查看细微波动)"
            >
              <ZoomIn size={15} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold text-slate-400 hidden sm:inline-flex items-center gap-1">
            <MoveHorizontal size={13} className="text-slate-400" />
            按住鼠标拖拽/触控板可左右滑动
          </span>
          <button
            type="button"
            onClick={() => scrollToLatest(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 hover:text-emerald-600 hover:border-emerald-200 rounded-xl text-xs font-bold shadow-2xs transition-all cursor-pointer active:scale-95"
            title="平滑滚动至最新K线"
          >
            <ChevronsRight size={14} className="text-emerald-500" />
            滑至最新
          </button>
        </div>
      </div>

      {/* Main Chart Scrollable Viewport with Fixed Left Y-Axis */}
      <div 
        className="relative w-full rounded-2xl border border-slate-100 bg-white shadow-xs overflow-hidden select-none"
        style={{ height }}
      >
        {/* Sticky Y-Axis Legend Bar on the Left */}
        <div 
          className="absolute left-0 top-0 bottom-0 w-[72px] z-20 pointer-events-none bg-gradient-to-r from-white via-white/95 to-white/0 border-r border-slate-100/60 flex flex-col justify-between py-6 pl-3 pr-2 text-right"
        >
          {yTicks.slice().reverse().map((tick, i) => (
            <div key={i} className="font-mono text-[10px] font-bold text-slate-400">
              {tick >= 0 ? '+' : ''}{tick.toFixed(2)}
            </div>
          ))}
        </div>

        {/* Scrollable Container */}
        <div 
          ref={scrollContainerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className={`w-full h-full overflow-x-auto overflow-y-hidden ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          style={{ scrollBehavior: 'auto' }}
        >
          <svg 
            width={totalSvgWidth} 
            height={height} 
            className="overflow-visible"
          >
            {/* Horizontal Grid lines */}
            {yTicks.map((tick, i) => {
              const y = mapY(tick);
              return (
                <g key={i}>
                  <line 
                    x1={paddingLeft} 
                    y1={y} 
                    x2={totalSvgWidth - paddingRight} 
                    y2={y} 
                    stroke="#f8fafc" 
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                </g>
              );
            })}

            {/* Zero baseline line if zero is in range */}
            {yMin < 0 && yMax > 0 && (
              <line 
                x1={paddingLeft} 
                y1={mapY(0)} 
                x2={totalSvgWidth - paddingRight} 
                y2={mapY(0)} 
                stroke="#cbd5e1" 
                strokeWidth={1.5}
                strokeDasharray="4 4"
              />
            )}

            {/* X Axis line */}
            <line 
              x1={paddingLeft} 
              y1={height - paddingBottom} 
              x2={totalSvgWidth - paddingRight} 
              y2={height - paddingBottom} 
              stroke="#f1f5f9" 
              strokeWidth={1.5}
            />

            {/* Candles and vertical bars */}
            {data.map((d, i) => {
              const cx = paddingLeft + i * cellWidth + cellWidth / 2;
              const yHigh = mapY(d.high);
              const yLow = mapY(d.low);
              const yOpen = mapY(d.open);
              const yClose = mapY(d.close);
              const isUp = d.close >= d.open;
              const color = isUp ? '#10b981' : '#ef4444';
              const isHovered = hoveredIdx === i;

              // Smart X label visibility condition:
              const shouldShowLabel = (i % labelInterval === 0) || (i === data.length - 1);

              return (
                <g 
                  key={d.time}
                  onMouseEnter={() => {
                    setHoveredIdx(i);
                    setTooltipPos({ x: cx, y: Math.min(yOpen, yClose) });
                  }}
                  onMouseLeave={() => setHoveredIdx(null)}
                  className="cursor-pointer"
                >
                  {/* Highlight bar on hover */}
                  {isHovered && (
                    <rect 
                      x={paddingLeft + i * cellWidth}
                      y={paddingTop}
                      width={cellWidth}
                      height={chartHeight}
                      fill="#f1f5f9"
                      opacity={0.6}
                    />
                  )}

                  {/* Wick */}
                  <line 
                    x1={cx} 
                    y1={yHigh} 
                    x2={cx} 
                    y2={yLow} 
                    stroke={color} 
                    strokeWidth={Math.max(cellWidth * 0.05, 1.5)} 
                  />

                  {/* Candle Body */}
                  <rect 
                    x={cx - bodyWidth / 2} 
                    y={Math.min(yOpen, yClose)} 
                    width={bodyWidth} 
                    height={Math.max(Math.abs(yOpen - yClose), 2.5)} 
                    fill={color} 
                    rx={Math.min(bodyWidth * 0.2, 2.5)}
                    className="transition-all duration-150"
                    style={{
                      filter: isHovered ? `drop-shadow(0 0 6px ${color}60)` : 'none'
                    }}
                  />

                  {/* Tick marker on axis */}
                  <line 
                    x1={cx} 
                    y1={height - paddingBottom} 
                    x2={cx} 
                    y2={height - paddingBottom + 4} 
                    stroke="#cbd5e1" 
                    strokeWidth={1} 
                  />

                  {/* X Axis Label with smart thinning */}
                  {shouldShowLabel && (
                    <text 
                      x={cx} 
                      y={height - paddingBottom + 20} 
                      textAnchor="middle" 
                      className="fill-slate-500 font-sans text-[10px] font-bold"
                    >
                      {formatXLabel(d.time)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Floating Tooltip */}
          {hoveredIdx !== null && data[hoveredIdx] && (
            <div 
              className="absolute z-50 bg-white/95 backdrop-blur-sm border border-slate-100 p-4 rounded-2xl shadow-2xl ring-1 ring-black/5 pointer-events-none transition-all duration-75 text-xs font-semibold"
              style={{
                left: `${tooltipPos.x + 15}px`,
                top: `${Math.min(tooltipPos.y, height - 190)}px`,
                transform: tooltipPos.x + 15 + 240 > totalSvgWidth ? 'translateX(-265px)' : 'none'
              }}
            >
              <div className="border-b border-slate-100 pb-2 mb-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{data[hoveredIdx].time}</p>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between gap-8">
                  <span className="text-slate-500">期初开盘:</span>
                  <span className="font-mono text-slate-800">{data[hoveredIdx].open >= 0 ? '+' : ''}{data[hoveredIdx].open.toFixed(2)} USDT</span>
                </div>
                <div className="flex justify-between gap-8">
                  <span className="text-slate-500">期末收盘:</span>
                  <span className="font-mono text-slate-800 font-bold">{data[hoveredIdx].close >= 0 ? '+' : ''}{data[hoveredIdx].close.toFixed(2)} USDT</span>
                </div>
                <div className="flex justify-between gap-8">
                  <span className="text-slate-500">期间最高:</span>
                  <span className="font-mono text-emerald-600">{data[hoveredIdx].high >= 0 ? '+' : ''}{data[hoveredIdx].high.toFixed(2)} USDT</span>
                </div>
                <div className="flex justify-between gap-8">
                  <span className="text-slate-500">期间最低:</span>
                  <span className="font-mono text-red-500">{data[hoveredIdx].low >= 0 ? '+' : ''}{data[hoveredIdx].low.toFixed(2)} USDT</span>
                </div>
                <div className="flex justify-between gap-8 border-t border-slate-50 pt-1 mt-1">
                  <span className="text-slate-500">期间变化:</span>
                  <span className={`font-mono font-bold ${data[hoveredIdx].change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {data[hoveredIdx].change >= 0 ? '+' : ''}{data[hoveredIdx].change.toFixed(2)} USDT
                  </span>
                </div>
                <div className="flex justify-between gap-8">
                  <span className="text-slate-500">期间成交:</span>
                  <span className="font-mono text-blue-600 font-bold">{data[hoveredIdx].tradesCount} 笔订单</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BalanceHistory({ 
  balanceLogs = [], 
  transferLogs = [],
  tradeLogs = [],
  account,
  onClearTransfers,
  accountId
}: { 
  balanceLogs?: BalanceLog[], 
  transferLogs?: TransferLog[],
  tradeLogs?: TradeLog[],
  account: any,
  onClearTransfers: () => void,
  accountId: string
}) {
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Initial Cum Pnl Setting State
  const [initialCumPnlInput, setInitialCumPnlInput] = useState<string>(() => {
    return localStorage.getItem(`initialCumPnl_${accountId}`) || '0';
  });
  const [initialCumPnl, setInitialCumPnl] = useState<number>(() => {
    return parseFloat(localStorage.getItem(`initialCumPnl_${accountId}`) || '0') || 0;
  });
  const [isSavingInitialPnl, setIsSavingInitialPnl] = useState(false);

  // Sync initialCumPnl from server settings when accountId changes or on mount
  useEffect(() => {
    let isMounted = true;
    const fetchAccountInitialPnl = async () => {
      try {
        const res = await fetch(`/api/settings?accountId=${accountId}`);
        if (res.ok) {
          const data = await res.json();
          if (data && isMounted) {
            const serverVal = typeof data.initialCumPnl === 'number' 
              ? data.initialCumPnl 
              : parseFloat(data.initialCumPnl || '0') || 0;
            setInitialCumPnl(serverVal);
            setInitialCumPnlInput(String(serverVal));
            localStorage.setItem(`initialCumPnl_${accountId}`, String(serverVal));
            return;
          }
        }
      } catch (err) {
        console.error('Failed to fetch initialCumPnl from server:', err);
      }
      if (isMounted) {
        const saved = localStorage.getItem(`initialCumPnl_${accountId}`) || '0';
        setInitialCumPnlInput(saved);
        setInitialCumPnl(parseFloat(saved) || 0);
      }
    };

    fetchAccountInitialPnl();
    return () => { isMounted = false; };
  }, [accountId]);

  const handleSaveInitialPnl = async () => {
    const val = parseFloat(initialCumPnlInput) || 0;
    setInitialCumPnl(val);
    localStorage.setItem(`initialCumPnl_${accountId}`, String(val));
    
    setIsSavingInitialPnl(true);
    try {
      // 1. Fetch current settings for this account
      const res = await fetch(`/api/settings?accountId=${accountId}`);
      if (!res.ok) throw new Error('获取当前配置失败');
      const currentSettings = await res.json();

      // 2. Update initialCumPnl and post to server (saving to SQLite & settings.json)
      const updatedSettings = {
        ...currentSettings,
        initialCumPnl: val
      };

      const saveRes = await fetch(`/api/settings?accountId=${accountId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSettings)
      });

      if (!saveRes.ok) throw new Error('保存到数据库失败');
      alert(`期初累计盈亏已成功保存到数据库: ${val >= 0 ? '+' : ''}${val.toFixed(4)} USDT`);
    } catch (err: any) {
      console.error('Save initialCumPnl to server error:', err);
      alert(`期初累计盈亏已在本地缓存生效，但同步到数据库时出现提示: ${err.message}`);
    } finally {
      setIsSavingInitialPnl(false);
    }
  };

  // Tabs structure: 'trend' (Continuous cumulative PnL trend) vs 'periods' (Candlestick Analysis)
  const [activeTab, setActiveTab] = useState<'trend' | 'periods'>('trend');
  const [periodType, setPeriodType] = useState<'1h' | '4h' | 'day' | 'week' | 'month'>('day');
  const [periodViewMode, setPeriodViewMode] = useState<'chart' | 'table'>('chart');

  // Trend View Zoom & Brush states
  const [trendBrushIndices, setTrendBrushIndices] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const [trendPreset, setTrendPreset] = useState<'all' | '24h' | '3d' | '7d' | '30d' | 'custom'>('all');
  const [trendStartDate, setTrendStartDate] = useState<string>('');
  const [trendEndDate, setTrendEndDate] = useState<string>('');
  const [showCustomDateInputs, setShowCustomDateInputs] = useState<boolean>(false);

  // Filter valid closed trades
  const validClosedTrades = useMemo(() => {
    return tradeLogs
      .filter(log => log.status !== 'OPEN' && !log.isSkipMark && log.status !== 'SKIPPED' && log.symbol !== '[扫跳重置]')
      .sort((a, b) => {
        const timeA = a.closeTime || a.openTime || 0;
        const timeB = b.closeTime || b.openTime || 0;
        if (timeA !== timeB) return timeA - timeB;
        return String(a.id).localeCompare(String(b.id));
      });
  }, [tradeLogs]);

  // Continuous "实时累计盈亏" rendering data
  const chartData = useMemo(() => {
    if (validClosedTrades.length === 0) {
      return [{
        time: '期初',
        fullTime: '期初基准',
        cumPnl: initialCumPnl,
        netPnl: 0,
        symbol: '--',
        timestamp: Date.now()
      }];
    }

    let runningPnl = initialCumPnl;
    return validClosedTrades.map(log => {
      const net = log.pnl - log.fee + (log.fundingFee || 0);
      runningPnl += net;
      const ts = log.closeTime || log.openTime || Date.now();
      const dateObj = new Date(ts + 8 * 3600 * 1000); // UTC+8
      const timeStr = dateObj.toISOString().replace('T', ' ').substring(5, 16);
      const fullTimeStr = dateObj.toISOString().replace('T', ' ').substring(0, 19);

      return {
        time: timeStr,
        fullTime: fullTimeStr,
        cumPnl: parseFloat(runningPnl.toFixed(4)),
        netPnl: parseFloat(net.toFixed(4)),
        symbol: log.symbol,
        timestamp: ts
      };
    });
  }, [validClosedTrades, initialCumPnl]);

  const currentCumPnl = chartData[chartData.length - 1]?.cumPnl ?? initialCumPnl;
  const minCumPnl = Math.min(...chartData.map(d => d.cumPnl), initialCumPnl) - 5;
  const maxCumPnl = Math.max(...chartData.map(d => d.cumPnl), initialCumPnl) + 5;

  const visibleChartData = useMemo(() => {
    if (chartData.length === 0) return [];
    const start = trendBrushIndices ? Math.max(0, Math.min(trendBrushIndices.startIndex, chartData.length - 1)) : 0;
    const end = trendBrushIndices ? Math.min(chartData.length - 1, Math.max(trendBrushIndices.endIndex, 0)) : chartData.length - 1;
    return chartData.slice(start, end + 1);
  }, [chartData, trendBrushIndices]);

  const dynamicMinCumPnl = useMemo(() => {
    if (visibleChartData.length === 0) return minCumPnl;
    const min = Math.min(...visibleChartData.map(d => d.cumPnl));
    const max = Math.max(...visibleChartData.map(d => d.cumPnl));
    const diff = max - min || 5;
    return parseFloat((min - diff * 0.12).toFixed(2));
  }, [visibleChartData, minCumPnl]);

  const dynamicMaxCumPnl = useMemo(() => {
    if (visibleChartData.length === 0) return maxCumPnl;
    const min = Math.min(...visibleChartData.map(d => d.cumPnl));
    const max = Math.max(...visibleChartData.map(d => d.cumPnl));
    const diff = max - min || 5;
    return parseFloat((max + diff * 0.12).toFixed(2));
  }, [visibleChartData, maxCumPnl]);

  const handleTrendPreset = (preset: 'all' | '24h' | '3d' | '7d' | '30d' | 'custom') => {
    setTrendPreset(preset);
    if (preset === 'custom') {
      setShowCustomDateInputs(true);
      return;
    }
    setShowCustomDateInputs(false);
    if (chartData.length === 0) return;
    const now = Date.now();
    let msAgo = 0;
    if (preset === '24h') msAgo = 24 * 3600 * 1000;
    else if (preset === '3d') msAgo = 3 * 24 * 3600 * 1000;
    else if (preset === '7d') msAgo = 7 * 24 * 3600 * 1000;
    else if (preset === '30d') msAgo = 30 * 24 * 3600 * 1000;

    if (msAgo === 0) {
      setTrendBrushIndices({ startIndex: 0, endIndex: chartData.length - 1 });
    } else {
      const targetTs = now - msAgo;
      let foundIdx = chartData.findIndex(d => (d.timestamp || 0) >= targetTs);
      if (foundIdx === -1) {
        foundIdx = Math.max(0, chartData.length - Math.min(chartData.length, 12));
      }
      setTrendBrushIndices({ startIndex: foundIdx, endIndex: chartData.length - 1 });
    }
  };

  const handleApplyCustomDateRange = () => {
    if (!trendStartDate && !trendEndDate) return;
    setTrendPreset('custom');

    // Convert start date to Beijing 00:00:00 timestamp
    const startTs = trendStartDate 
      ? new Date(`${trendStartDate}T00:00:00+08:00`).getTime() 
      : 0;

    // Convert end date to Beijing 23:59:59.999 timestamp
    const endTs = trendEndDate 
      ? new Date(`${trendEndDate}T23:59:59.999+08:00`).getTime() 
      : Number.MAX_SAFE_INTEGER;

    let startIndex = 0;
    let endIndex = chartData.length - 1;

    if (startTs > 0) {
      const foundStart = chartData.findIndex(d => (d.timestamp || 0) >= startTs);
      if (foundStart !== -1) {
        startIndex = foundStart;
      } else {
        startIndex = chartData.length - 1;
      }
    }

    if (endTs < Number.MAX_SAFE_INTEGER) {
      let foundEnd = -1;
      for (let i = chartData.length - 1; i >= 0; i--) {
        if ((chartData[i].timestamp || 0) <= endTs) {
          foundEnd = i;
          break;
        }
      }
      if (foundEnd !== -1) {
        endIndex = foundEnd;
      }
    }

    if (startIndex > endIndex) {
      startIndex = Math.min(startIndex, endIndex);
    }

    setTrendBrushIndices({ startIndex, endIndex });
  };

  const handleResetCustomDateRange = () => {
    setTrendStartDate('');
    setTrendEndDate('');
    setShowCustomDateInputs(false);
    handleTrendPreset('all');
  };

  const handleTrendZoomIn = () => {
    setTrendPreset('all');
    const currentStart = trendBrushIndices ? trendBrushIndices.startIndex : 0;
    const currentEnd = trendBrushIndices ? trendBrushIndices.endIndex : chartData.length - 1;
    const range = currentEnd - currentStart;
    if (range <= 4) return;
    const step = Math.max(1, Math.floor(range * 0.2));
    setTrendBrushIndices({
      startIndex: Math.min(currentStart + step, currentEnd - 2),
      endIndex: Math.max(currentEnd - step, currentStart + 2)
    });
  };

  const handleTrendZoomOut = () => {
    setTrendPreset('all');
    const currentStart = trendBrushIndices ? trendBrushIndices.startIndex : 0;
    const currentEnd = trendBrushIndices ? trendBrushIndices.endIndex : chartData.length - 1;
    const range = currentEnd - currentStart;
    const step = Math.max(1, Math.floor(range * 0.25));
    setTrendBrushIndices({
      startIndex: Math.max(0, currentStart - step),
      endIndex: Math.min(chartData.length - 1, currentEnd + step)
    });
  };

  const handleTrendScrollLatest = () => {
    const currentStart = trendBrushIndices ? trendBrushIndices.startIndex : 0;
    const currentEnd = trendBrushIndices ? trendBrushIndices.endIndex : chartData.length - 1;
    const windowSize = Math.max(2, currentEnd - currentStart);
    setTrendBrushIndices({
      startIndex: Math.max(0, chartData.length - 1 - windowSize),
      endIndex: chartData.length - 1
    });
  };

  // Helper function to generate Beijing time keys for 1h/4h/day/week/month
  const getBeijingKey = (ts: number, period: '1h' | '4h' | 'day' | 'week' | 'month') => {
    const d = new Date(ts + 8 * 3600 * 1000); // UTC+8
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const date = String(d.getUTCDate()).padStart(2, '0');
    const hours = d.getUTCHours();

    if (period === '1h') {
      const hStr = String(hours).padStart(2, '0');
      return `${year}-${month}-${date} ${hStr}:00`;
    }
    if (period === '4h') {
      const block = Math.floor(hours / 4) * 4;
      const hStr = String(block).padStart(2, '0');
      return `${year}-${month}-${date} ${hStr}:00`;
    }
    if (period === 'day') {
      return `${year}-${month}-${date}`;
    }
    if (period === 'week') {
      const dayOfWeek = d.getUTCDay(); // 0(Sun) - 6(Sat)
      const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const mon = new Date(d.getTime() + diffToMon * 86400000);
      const monY = mon.getUTCFullYear();
      const monM = String(mon.getUTCMonth() + 1).padStart(2, '0');
      const monD = String(mon.getUTCDate()).padStart(2, '0');

      const yearStart = new Date(Date.UTC(monY, 0, 1));
      const weekNo = Math.ceil((((mon.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      return `${monY}年 W${weekNo} (周一 ${monM}-${monD})`;
    }
    // month
    return `${year}年 ${month}月`;
  };

  // Grouping algorithm for cumulative PnL OHLC candlestick analysis
  const candlestickData = useMemo(() => {
    if (validClosedTrades.length === 0) return [];

    const groups: { [key: string]: typeof validClosedTrades } = {};
    const groupKeysInOrder: string[] = [];

    validClosedTrades.forEach(log => {
      const ts = log.closeTime || log.openTime || Date.now();
      const key = getBeijingKey(ts, periodType);
      if (!groups[key]) {
        groups[key] = [];
        groupKeysInOrder.push(key);
      }
      groups[key].push(log);
    });

    let prevClose = initialCumPnl;
    const result = [];

    for (const key of groupKeysInOrder) {
      const logs = groups[key];
      const open = prevClose;
      let currentPnl = prevClose;
      let high = prevClose;
      let low = prevClose;

      logs.forEach(log => {
        const net = log.pnl - log.fee + (log.fundingFee || 0);
        currentPnl += net;
        if (currentPnl > high) high = currentPnl;
        if (currentPnl < low) low = currentPnl;
      });

      const close = currentPnl;
      prevClose = close;

      const change = close - open;
      const amplitude = Math.abs(high - low);

      result.push({
        time: key,
        open: parseFloat(open.toFixed(4)),
        close: parseFloat(close.toFixed(4)),
        high: parseFloat(high.toFixed(4)),
        low: parseFloat(low.toFixed(4)),
        change: parseFloat(change.toFixed(4)),
        amplitude: parseFloat(amplitude.toFixed(4)),
        tradesCount: logs.length,
        logs
      });
    }

    return result;
  }, [validClosedTrades, periodType, initialCumPnl]);

  const filteredTransferLogs = useMemo(() => {
    return transferLogs.filter(log => {
      const matchesSearch = log.asset.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           log.message?.toLowerCase().includes(searchTerm.toLowerCase());
      const logTime = log.timestamp;
      
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
  }, [transferLogs, searchTerm, startTime, endTime]);

  const formatMs = (ts: number) => {
    if (!ts || ts === 0) return '--';
    const date = new Date(ts + 8 * 3600 * 1000);
    return date.toISOString().replace('T', ' ').substring(0, 19);
  };

  const handleExportCumPnl = () => {
    if (chartData.length === 0) return;
    
    const headers = ['时间', '交易合约', '单笔净盈亏(USDT)', '实时累计盈亏(USDT)'];
    const rows = chartData.map(log => [
      log.fullTime,
      log.symbol,
      log.netPnl.toFixed(4),
      log.cumPnl.toFixed(4)
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
    
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `cum_pnl_history_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadTransferCSV = () => {
    if (filteredTransferLogs.length === 0) return;
    
    const headers = ['ID', '资产', '数量', '类型', '状态', '时间', '备注'];
    const rows = filteredTransferLogs.map(log => [
      log.id,
      log.asset,
      log.amount,
      log.type === 'IN' ? '现货 -> 合约' : '合约 -> 现货',
      log.status === 'SUCCESS' ? '成功' : '失败',
      formatMs(log.timestamp),
      log.message || ''
    ]);
    
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `transfer_logs_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      {/* 1. Real-time Cumulative PnL Header Card */}
      <div className="bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
              <TrendingUp className="text-emerald-500" size={28} />
              实时累计盈亏图表 (基于本地交易日志)
            </h2>
            <p className="text-slate-500 text-sm font-medium mt-1">
              由本地数据库已平仓订单推演计算，北京时间 (UTC+8) 自然周期切分
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {/* Initial Cum PnL Config Box */}
            <div className="flex items-center gap-2 bg-slate-50 p-2 border border-slate-200 rounded-2xl">
              <DollarSign size={16} className="text-slate-400 ml-1" />
              <span className="text-xs font-bold text-slate-600 whitespace-nowrap">期初累计盈亏:</span>
              <input 
                type="number"
                step="0.0001"
                value={initialCumPnlInput}
                onChange={(e) => setInitialCumPnlInput(e.target.value)}
                className="w-24 px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                placeholder="0.00"
              />
              <button
                onClick={handleSaveInitialPnl}
                disabled={isSavingInitialPnl}
                className="flex items-center gap-1 px-3 py-1 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-50"
                title="保存期初盈亏设定到数据库"
              >
                <Save size={12} className={isSavingInitialPnl ? "animate-spin" : ""} />
                {isSavingInitialPnl ? "保存中..." : "保存"}
              </button>
            </div>

            <div className="bg-slate-100 p-1 rounded-2xl flex">
              <button 
                type="button"
                onClick={() => setActiveTab('trend')}
                className={`px-4 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${activeTab === 'trend' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                分时累计趋势
              </button>
              <button 
                type="button"
                onClick={() => setActiveTab('periods')}
                className={`px-4 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${activeTab === 'periods' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                K线周期分析
              </button>
            </div>

            <button 
              onClick={handleExportCumPnl}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-emerald-100 transition-all active:scale-95 cursor-pointer"
            >
              <Download size={14} />
              导出盈亏数据
            </button>
          </div>
        </div>

        {/* Dynamic Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">当前实时累计净盈亏</span>
            <span className={`text-2xl font-black font-mono ${currentCumPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {currentCumPnl >= 0 ? '+' : ''}{currentCumPnl.toFixed(4)} <span className="text-xs">USDT</span>
            </span>
          </div>
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">包含已结订单数</span>
            <span className="text-2xl font-black font-mono text-slate-800">
              {validClosedTrades.length} <span className="text-xs">笔</span>
            </span>
          </div>
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">期初基准设定</span>
            <span className="text-2xl font-black font-mono text-slate-700">
              {initialCumPnl >= 0 ? '+' : ''}{initialCumPnl.toFixed(4)} <span className="text-xs">USDT</span>
            </span>
          </div>
        </div>

        {activeTab === 'periods' && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50 p-4 rounded-3xl gap-4 mb-6">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600">展示周期尺度:</span>
                <div className="bg-slate-200 p-0.5 rounded-xl flex gap-1 flex-wrap">
                  <button 
                    type="button" 
                    onClick={() => setPeriodType('1h')}
                    className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${periodType === '1h' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}
                  >
                    1小时 (1H)
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setPeriodType('4h')}
                    className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${periodType === '4h' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}
                  >
                    4小时 (4H)
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setPeriodType('day')}
                    className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${periodType === 'day' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}
                  >
                    日线 (1D)
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setPeriodType('week')}
                    className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${periodType === 'week' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}
                  >
                    周线 (1W)
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setPeriodType('month')}
                    className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${periodType === 'month' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}
                  >
                    月线 (1M)
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:border-l sm:border-slate-200 sm:pl-6">
                <span className="text-xs font-bold text-slate-600">展示视图模式:</span>
                <div className="bg-slate-200 p-0.5 rounded-xl flex gap-1">
                  <button 
                    type="button" 
                    onClick={() => setPeriodViewMode('chart')}
                    className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${periodViewMode === 'chart' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}
                  >
                    图表视图
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setPeriodViewMode('table')}
                    className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${periodViewMode === 'table' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}
                  >
                    表格视图
                  </button>
                </div>
              </div>
            </div>
            <div className="text-[10px] text-slate-400 font-medium sm:text-right">
              北京时间 (UTC+8) 自然整点与自然日切分
            </div>
          </div>
        )}

        {activeTab === 'trend' ? (
          /* Trend Chart Render */
          <div className="space-y-3 mt-4">
            {/* Trend Interactive Zoom & Quick Range Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200/80 px-4 py-2.5 rounded-2xl">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <SlidersHorizontal size={14} className="text-emerald-500" />
                  区间范围:
                </span>
                <div className="bg-white border border-slate-200 p-0.5 rounded-xl flex gap-1 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => handleTrendPreset('all')}
                    className={`px-3 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                      trendPreset === 'all' && (!trendBrushIndices || (trendBrushIndices.startIndex === 0 && trendBrushIndices.endIndex === chartData.length - 1))
                        ? 'bg-emerald-50 text-emerald-600 font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    全部
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTrendPreset('24h')}
                    className={`px-3 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                      trendPreset === '24h' ? 'bg-emerald-50 text-emerald-600 font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    近24小时
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTrendPreset('3d')}
                    className={`px-3 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                      trendPreset === '3d' ? 'bg-emerald-50 text-emerald-600 font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    近3天
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTrendPreset('7d')}
                    className={`px-3 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                      trendPreset === '7d' ? 'bg-emerald-50 text-emerald-600 font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    近7天
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTrendPreset('30d')}
                    className={`px-3 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                      trendPreset === '30d' ? 'bg-emerald-50 text-emerald-600 font-bold' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    近30日
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (showCustomDateInputs) {
                        setShowCustomDateInputs(false);
                      } else {
                        handleTrendPreset('custom');
                      }
                    }}
                    className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                      trendPreset === 'custom' || showCustomDateInputs
                        ? 'bg-emerald-50 text-emerald-600 font-bold ring-1 ring-emerald-300'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Calendar size={13} className="text-emerald-500" />
                    自定义日期
                  </button>
                </div>

                <div className="flex items-center bg-white border border-slate-200 rounded-xl p-0.5 shadow-2xs">
                  <button
                    type="button"
                    onClick={handleTrendZoomOut}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all cursor-pointer"
                    title="缩小视图 (展示更多历史点)"
                  >
                    <ZoomOut size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={handleTrendZoomIn}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all cursor-pointer"
                    title="放大视图 (放大局部波动细节)"
                  >
                    <ZoomIn size={15} />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-[11px] font-semibold text-slate-400 hidden sm:inline-flex items-center gap-1">
                  <MoveHorizontal size={13} className="text-slate-400" />
                  拖动底部滑块可自由选择与左右平移时间窗口
                </span>
                <button
                  type="button"
                  onClick={handleTrendScrollLatest}
                  className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 hover:text-emerald-600 hover:border-emerald-200 rounded-xl text-xs font-bold shadow-2xs transition-all cursor-pointer active:scale-95"
                  title="滑至最新平仓点"
                >
                  <ChevronsRight size={14} className="text-emerald-500" />
                  滑至最新
                </button>
              </div>
            </div>

            {/* Expandable Custom Date Range Selector Bar */}
            {showCustomDateInputs && (
              <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-emerald-50/70 to-slate-50 border border-emerald-200/80 p-3 rounded-2xl shadow-xs animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Calendar size={14} className="text-emerald-600" />
                    按日期筛选 (北京时间 UTC+8):
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={trendStartDate}
                      onChange={(e) => setTrendStartDate(e.target.value)}
                      className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-2xs"
                      title="开始日期"
                    />
                    <span className="text-slate-400 text-xs font-bold">至</span>
                    <input
                      type="date"
                      value={trendEndDate}
                      onChange={(e) => setTrendEndDate(e.target.value)}
                      className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-2xs"
                      title="结束日期"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleApplyCustomDateRange}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-2xs"
                  >
                    确定筛选
                  </button>
                  <button
                    type="button"
                    onClick={handleResetCustomDateRange}
                    className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 hover:text-slate-900 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-2xs"
                  >
                    清空重置
                  </button>
                </div>
                <span className="text-[11px] text-slate-400 font-medium hidden md:inline-block">
                  选定后自动缩放至对应区间的平仓记录
                </span>
              </div>
            )}

            <div className="h-[430px] w-full bg-white rounded-2xl border border-slate-100 p-2 shadow-xs">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 8 }}>
                    <defs>
                      <linearGradient id="colorCumPnl" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.18}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="time" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                      minTickGap={45}
                    />
                    <YAxis 
                      domain={[dynamicMinCumPnl, dynamicMaxCumPnl]} 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                      tickFormatter={(val) => `${val >= 0 ? '+' : ''}${val.toFixed(1)}`}
                    />
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const dataItem = payload[0].payload;
                          return (
                            <div className="bg-white/95 backdrop-blur-sm border border-slate-100 p-4 rounded-2xl shadow-2xl ring-1 ring-black/5">
                              <p className="text-[10px] font-black text-slate-400 uppercase mb-1">{dataItem.fullTime}</p>
                              <p className="text-xs text-slate-500 font-bold mb-1">合约: {dataItem.symbol}</p>
                              <div className="flex justify-between gap-4 text-xs">
                                <span className="text-slate-500">单笔净盈亏:</span>
                                <span className={`font-mono font-bold ${dataItem.netPnl >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                  {dataItem.netPnl >= 0 ? '+' : ''}{dataItem.netPnl.toFixed(4)} USDT
                                </span>
                              </div>
                              <div className="flex justify-between gap-4 text-xs border-t border-slate-100 pt-1 mt-1">
                                <span className="text-slate-600 font-bold">实时累计盈亏:</span>
                                <span className={`font-mono font-black ${dataItem.cumPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {dataItem.cumPnl >= 0 ? '+' : ''}{dataItem.cumPnl.toFixed(4)} USDT
                                </span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    
                    {/* Zero reference line */}
                    <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="3 3" />

                    <Area 
                      type="monotone" 
                      dataKey="cumPnl" 
                      stroke="#10b981" 
                      strokeWidth={2.5}
                      fillOpacity={1} 
                      fill="url(#colorCumPnl)" 
                      animationDuration={400}
                    />

                    {/* Interactive Zoom Brush Bar */}
                    {chartData.length > 2 && (
                      <Brush 
                        dataKey="time" 
                        height={32} 
                        stroke="#10b981" 
                        fill="#f8fafc" 
                        startIndex={trendBrushIndices ? trendBrushIndices.startIndex : 0}
                        endIndex={trendBrushIndices ? trendBrushIndices.endIndex : chartData.length - 1}
                        onChange={(range: any) => {
                          if (range && typeof range.startIndex === 'number' && typeof range.endIndex === 'number') {
                            setTrendBrushIndices({ startIndex: range.startIndex, endIndex: range.endIndex });
                          }
                        }}
                        tickFormatter={(val) => val ? val.substring(5) : ''}
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4">
                  <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center">
                    <ChartIcon size={32} className="text-slate-300" />
                  </div>
                  <p className="text-xs font-bold uppercase tracking-widest">等待第一笔平仓订单数据...</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Candlestick / Period analysis render */
          <div className="space-y-6 mt-4">
            {candlestickData.length > 0 ? (
              periodViewMode === 'chart' ? (
                /* Candlestick Chart Render */
                <div className="w-full">
                  <CandlestickChart data={candlestickData} height={430} />
                </div>
              ) : (
                /* Candlestick / Period table view */
                <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/80 border-b border-slate-100">
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">周期节点</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">烛线示意</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">期初开盘</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">期末收盘</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">期间最高</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">期间最低</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">周期波幅</th>
                          <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">周期变动 (USDT)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono text-xs">
                        {candlestickData.map((candle) => {
                          const isUp = candle.close >= candle.open;
                          
                          const rangeVal = candle.high - candle.low;
                          const hasRange = rangeVal > 0;
                          const wickTop = hasRange ? ((candle.high - Math.max(candle.open, candle.close)) / rangeVal) * 100 : 0;
                          const bodyHeight = hasRange ? (Math.abs(candle.open - candle.close) / rangeVal) * 100 : 100;

                          return (
                            <tr key={candle.time} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-6 py-4 font-sans font-bold text-slate-700">{candle.time}</td>
                              
                              <td className="px-6 py-4">
                                <div className="flex justify-center items-center h-10 w-16 mx-auto relative group" title={`H: ${candle.high}, L: ${candle.low}, O: ${candle.open}, C: ${candle.close}`}>
                                  {hasRange ? (
                                    <>
                                      <div className="absolute w-[2px] bg-slate-300 h-full left-1/2 -translate-x-1/2" />
                                      <div 
                                        className={`absolute w-3 rounded-sm ${isUp ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.3)]'}`}
                                        style={{
                                          top: `${wickTop}%`,
                                          height: `${Math.max(bodyHeight, 6)}%`
                                        }}
                                      />
                                    </>
                                  ) : (
                                    <div className="w-3 h-1.5 rounded-sm bg-slate-400" />
                                  )}
                                </div>
                              </td>

                              <td className="px-6 py-4 font-bold text-slate-600">{candle.open >= 0 ? '+' : ''}{candle.open.toFixed(2)}</td>
                              <td className="px-6 py-4 font-black text-slate-800">{candle.close >= 0 ? '+' : ''}{candle.close.toFixed(2)}</td>
                              <td className="px-6 py-4 text-emerald-600">{candle.high >= 0 ? '+' : ''}{candle.high.toFixed(2)}</td>
                              <td className="px-6 py-4 text-red-500">{candle.low >= 0 ? '+' : ''}{candle.low.toFixed(2)}</td>
                              <td className="px-6 py-4">
                                <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded-lg font-black text-[10px]">
                                  {candle.amplitude.toFixed(2)} USDT
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <span className={`px-2 py-1 rounded-lg font-black text-[10px] ${isUp ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                                  {isUp ? '+' : ''}{candle.change.toFixed(2)} USDT
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            ) : (
              <div className="bg-slate-50 rounded-3xl p-12 text-center text-slate-400 flex flex-col items-center justify-center border border-dashed border-slate-200">
                <p className="text-xs font-bold uppercase tracking-widest mb-1">暂无已平仓订单记录</p>
                <p className="text-[11px] text-slate-400">系统产生已平仓订单后将自动以此处 K 线展示累计盈亏变化。</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Transfer Logs Section */}
      <div className="bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-600/20">
              <ArrowLeftRight className="text-white" size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">资金划转日志</h2>
              <p className="text-slate-500 text-sm font-medium">记录系统自动执行的资金划转信息</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={downloadTransferCSV}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 font-bold text-xs uppercase tracking-widest transition-all cursor-pointer"
            >
              <Download size={14} />
              导出划转日志
            </button>
            <button 
              onClick={() => {
                if (window.confirm('确定要清空所有资金划转日志吗？此操作不可撤销。')) {
                  onClearTransfers();
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 border border-red-100 rounded-xl hover:bg-red-100 font-bold text-xs uppercase tracking-widest transition-all cursor-pointer"
            >
              <Trash2 size={14} />
              清空日志
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">搜索资产/备注</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="text" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索..."
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all text-sm"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">开始时间</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="datetime-local" 
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all text-sm"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">结束时间</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="datetime-local" 
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-all text-sm"
              />
            </div>
          </div>
          <div className="flex items-end">
            <div className="bg-purple-50 rounded-xl px-4 py-2 border border-purple-100 w-full text-center">
              <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest block">筛选结果</span>
              <span className="text-lg font-black text-purple-700">{filteredTransferLogs.length} <span className="text-xs">条记录</span></span>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse table-fixed">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-200">
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[210px]">时间</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[80px]">资产</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[110px]">数量</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[140px]">类型</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[90px]">状态</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">备注</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTransferLogs.length > 0 ? (
                  filteredTransferLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-slate-700 font-mono whitespace-nowrap">{formatMs(log.timestamp)}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-black text-slate-900">{log.asset}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-black text-slate-900 font-mono whitespace-nowrap">{log.amount.toFixed(2)}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${
                          log.type === 'IN' 
                            ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                            : 'bg-blue-50 text-blue-600 border border-blue-100'
                        }`}>
                          {log.type === 'IN' ? '现货 -> 合约' : '合约 -> 现货'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${
                          log.status === 'SUCCESS' 
                            ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                            : 'bg-red-50 text-red-600 border border-red-100'
                        }`}>
                          {log.status === 'SUCCESS' ? '成功' : '失败'}
                        </span>
                      </td>
                      <td className="px-6 py-4 truncate">
                        <div className="text-xs text-slate-500 font-medium max-w-xs truncate" title={log.message}>
                          {log.message || '--'}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <ArrowLeftRight className="text-slate-200" size={48} />
                        <p className="text-slate-400 font-bold">暂无划转记录</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
