'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ParamsForm({ ticker, initial }: { ticker: string; initial: any }) {
  const [form, setForm] = useState({
    bbLen: initial?.bb_length ?? 100, rsiLen: initial?.rsi_length ?? 14, zLen: initial?.z_length ?? 50,
    smoothing: initial?.smoothing ?? 3, scale: initial?.scale_factor ?? 1.8,
    ob: initial?.ob_level ?? 1.5, os: initial?.os_level ?? -1.5,
  });
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function save() {
    setSaving(true);
    await fetch('/api/strategy-params', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, ...form }),
    });
    setSaving(false);
    router.refresh();
  }

  return (
    <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {Object.entries(form).map(([key, val]) => (
        <label key={key} style={{ fontSize: 12 }}>
          {key}
          <input
            type="number" step="0.1" value={val}
            onChange={e => setForm({ ...form, [key]: parseFloat(e.target.value) })}
            style={{ width: 60, marginLeft: 4 }}
          />
        </label>
      ))}
      <button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save & Rerun'}</button>
    </div>
  );
}