import { useState } from 'react';

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'lastmonth' | 'custom';

interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  preset?: Preset;
  onPresetChange?: (preset: Preset) => void;
  labelFrom?: string;
  labelTo?: string;
}

export function DateRangePicker({
  from,
  to,
  onChange,
  preset,
  onPresetChange,
  labelFrom = 'From',
  labelTo = 'To',
}: DateRangePickerProps) {
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);
  const [localPreset, setLocalPreset] = useState<Preset>(preset ?? 'custom');

  const presets: { value: Preset; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'week', label: 'This Week' },
    { value: 'month', label: 'This Month' },
    { value: 'lastmonth', label: 'Last Month' },
    { value: 'custom', label: 'Custom' },
  ];

  const applyPreset = (p: Preset) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let newFrom: Date, newTo: Date;

    switch (p) {
      case 'today':
        newFrom = new Date(today);
        newTo = new Date(today);
        break;
      case 'yesterday':
        newFrom = new Date(today);
        newFrom.setDate(newFrom.getDate() - 1);
        newTo = new Date(newFrom);
        break;
      case 'week':
        newFrom = new Date(today);
        newFrom.setDate(newFrom.getDate() - 6);
        newTo = new Date(today);
        break;
      case 'month':
        newFrom = new Date(today.getFullYear(), today.getMonth(), 1);
        newTo = new Date(today);
        break;
      case 'lastmonth':
        newFrom = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        newTo = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      case 'custom':
        return;
    }
    const fromStr = newFrom.toISOString().slice(0, 10);
    const toStr = newTo.toISOString().slice(0, 10);
    setLocalFrom(fromStr);
    setLocalTo(toStr);
    onChange(fromStr, toStr);
    onPresetChange?.(p);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <select
        className="field-select"
        value={localPreset}
        onChange={(e) => {
          const p = e.target.value as Preset;
          setLocalPreset(p);
          applyPreset(p);
        }}
        style={{ width: '140px' }}
      >
        {presets.map(({ value, label }) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px', color: '#666' }}>
        {labelFrom}
        <input
          type="date"
          value={localFrom}
          onChange={(e) => {
            setLocalFrom(e.target.value);
            if (localPreset !== 'custom') setLocalPreset('custom');
          }}
          style={{ width: '130px', marginLeft: 4 }}
        />
      </label>
      <span className="muted" style={{ fontSize: '12px' }}>to</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '12px', color: '#666' }}>
        {labelTo}
        <input
          type="date"
          value={localTo}
          onChange={(e) => {
            setLocalTo(e.target.value);
            if (localPreset !== 'custom') setLocalPreset('custom');
          }}
          style={{ width: '130px', marginLeft: 4 }}
        />
      </label>
    </div>
  );
}