import { useEffect, useRef, useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";

function ModelPicker({ options, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef(null);
  const selected = options.find((option) => option.key === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!pickerRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="review-model-picker" ref={pickerRef}>
      <span>本次使用</span>
      <button className={open ? "open" : ""} type="button" onClick={() => setOpen((current) => !current)} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}>
        <span><small>{selected?.providerName}</small><strong>{selected?.model}</strong></span>
        <CaretDown size={16} weight="bold" />
      </button>
      {open && (
        <div className="model-picker-menu" role="listbox" aria-label="选择本次调用的模型">
          {options.map((option) => (
            <button className={option.key === selected?.key ? "selected" : ""} type="button" role="option" aria-selected={option.key === selected?.key} key={option.key} onClick={() => { onChange(option.key); setOpen(false); }}>
              <span><small>{option.providerName}</small><strong>{option.model}</strong></span>
              {option.key === selected?.key && <Check size={15} weight="bold" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export { ModelPicker };
