export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

export interface LineDatum {
  label: string;
  values: number[];
}

export function LineChart({
  data,
  format,
  colors,
  seriesNames,
  height = 220,
  tickEvery = 2,
}: {
  data: LineDatum[];
  format: (value: number) => string;
  colors: string[];
  seriesNames: string[];
  height?: number;
  tickEvery?: number;
}) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-400">
        No data for this period.
      </p>
    );
  }
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  const padX = 8;
  const padTop = 12;
  const padBottom = 6;
  const w = 680;
  const h = height;
  const plotH = h - padTop - padBottom;
  const stepX = (w - padX * 2) / Math.max(1, data.length - 1);
  const y = (v: number) => padTop + plotH - (v / max) * plotH;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const yy = y(max * f);
          return (
            <line
              key={f}
              x1={padX}
              x2={w - padX}
              y1={yy}
              y2={yy}
              stroke="#eef2f7"
              strokeWidth={1}
            />
          );
        })}
        {seriesNames.map((_, si) => {
          const pts = data.map((d, i) => [
            padX + i * stepX,
            y(d.values[si] ?? 0),
          ]);
          const line = pts
            .map(([x, yy], i) => `${i === 0 ? "M" : "L"}${x},${yy}`)
            .join(" ");
          return (
            <g key={si}>
              <path
                d={line}
                fill="none"
                stroke={colors[si]}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {pts.map(([x, yy], i) => (
                <circle
                  key={i}
                  cx={x}
                  cy={yy}
                  r={3.5}
                  fill="#fff"
                  stroke={colors[si]}
                  strokeWidth={2}
                >
                  <title>{`${seriesNames[si]} ${data[i].label}: ${format(
                    data[i].values[si] ?? 0,
                  )}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex gap-1">
        {data.map((d, i) => (
          <div
            key={i}
            className="flex-1 truncate text-center text-[10px] text-slate-400"
          >
            {i % tickEvery === 0 ? d.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface PieDatum {
  label: string;
  value: number;
  color: string;
}

export function PieChart({
  data,
  format,
  size = 200,
  thickness = 26,
  centerLabel,
  centerValue,
}: {
  data: PieDatum[];
  format: (value: number) => string;
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total <= 0 || data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-400">No data.</p>
    );
  }
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  let acc = 0;

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div className="relative shrink-0">
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#f1f5f9"
            strokeWidth={thickness}
          />
          {data.map((d) => {
            const len = (d.value / total) * circ;
            const seg = (
              <circle
                key={d.label}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={thickness}
                strokeDasharray={`${len} ${circ - len}`}
                strokeDashoffset={-acc}
              >
                <title>{`${d.label}: ${format(d.value)}`}</title>
              </circle>
            );
            acc += len;
            return seg;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-slate-400">
            {centerLabel ?? "Total"}
          </span>
          <span className="text-lg font-bold text-slate-900">
            {centerValue ?? format(total)}
          </span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-2">
        {data.map((d) => (
          <li
            key={d.label}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: d.color }}
              />
              <span className="truncate text-slate-700">{d.label}</span>
            </span>
            <span className="shrink-0 text-slate-500">
              {Math.round((d.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BarChart({
  data,
  format,
  height = 180,
  tickEvery = 1,
}: {
  data: BarDatum[];
  format: (value: number) => string;
  height?: number;
  tickEvery?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((d, i) => (
          <div
            key={i}
            className="group relative flex h-full flex-1 flex-col justify-end"
            title={`${d.label}: ${format(d.value)}`}
          >
            {d.value > 0 && (
              <div
                className="w-full rounded-t bg-pharma-500 transition-colors group-hover:bg-pharma-600"
                style={{
                  height: `${Math.max(1.5, (d.value / max) * 100)}%`,
                  background: d.color,
                }}
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {data.map((d, i) => (
          <div
            key={i}
            className="flex-1 truncate text-center text-[10px] text-slate-400"
          >
            {i % tickEvery === 0 ? d.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

export function GroupedBars({
  data,
  format,
  colors,
  seriesNames,
  height = 180,
  tickEvery = 1,
}: {
  data: Array<{ label: string; values: number[] }>;
  format: (value: number) => string;
  colors: string[];
  seriesNames: string[];
  height?: number;
  tickEvery?: number;
}) {
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((d, i) => (
          <div
            key={i}
            className="flex h-full flex-1 items-end justify-center gap-0.5"
          >
            {d.values.map((v, j) => (
              <div
                key={j}
                className="relative flex h-full w-1/2 flex-col justify-end"
                title={`${seriesNames[j]} ${d.label}: ${format(v)}`}
              >
                <div
                  className="w-full rounded-t"
                  style={{
                    height: v > 0 ? `${Math.max(1.5, (v / max) * 100)}%` : "0%",
                    background: colors[j],
                  }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {data.map((d, i) => (
          <div
            key={i}
            className="flex-1 truncate text-center text-[10px] text-slate-400"
          >
            {i % tickEvery === 0 ? d.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HorizontalBars({
  data,
  format,
}: {
  data: BarDatum[];
  format: (value: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.label}>
          <div className="flex items-center justify-between text-sm">
            <span className="truncate pr-2 text-slate-700">{d.label}</span>
            <span className="shrink-0 font-medium text-slate-900">
              {format(d.value)}
            </span>
          </div>
          <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-2.5 rounded-full bg-pharma-500"
              style={{
                width: `${(d.value / max) * 100}%`,
                background: d.color,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
