import { useState, useEffect } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

const UNIT_SUFFIXES = [
  { suffix: "pct_rh", unit: "% RH" },
  { suffix: "celsius", unit: "°C" },
  { suffix: "rpm", unit: "RPM" },
  { suffix: "ppb", unit: "ppb" },
  { suffix: "pa", unit: "Pa" },
  { suffix: "kn", unit: "kN" },
  { suffix: "pct", unit: "%" },
];

export function extractParamMeta(colName) {
  for (const { suffix, unit } of UNIT_SUFFIXES) {
    if (colName.endsWith("_" + suffix)) {
      const label = colName
        .slice(0, -(suffix.length + 1))
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      return { unit, label };
    }
  }
  return {
    unit: "",
    label: colName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  };
}

export function useProductionData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/production-dashboard/summary`)
      .then((r) => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return r.json();
      })
      .then((json) => {
        // Annotate paramRanges with label/unit metadata (same as before, derived from field name)
        const paramRanges = {};
        if (json.paramRanges) {
          for (const [col, range] of Object.entries(json.paramRanges)) {
            paramRanges[col] = { ...range, ...extractParamMeta(col) };
          }
        }
        setData({ ...json, paramRanges });
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  return { data, loading, error };
}
