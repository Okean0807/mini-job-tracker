import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Input } from "@/components/ui/input";
import type { TFunction } from "@/lib/i18n";
import { groupObjectsForPicker, type ObjectUsage } from "@/lib/minijob/entry-objects";
import { objectAddressPreview } from "@/lib/minijob/work-objects";
import type { WorkObject } from "@/lib/minijob/types";
import { cn } from "@/lib/utils";

interface ObjectPickerProps {
  objects: readonly WorkObject[];
  usage: ObjectUsage;
  selectedId: string | undefined;
  /** Anzeige der aktuellen Auswahl (Titel und Adresse DES EINTRAGS, nicht des Katalogs). */
  children: ReactNode;
  onSelect: (id: string) => void;
  t: TFunction;
}

/**
 * B3: Suchbarer Einsatzort-Picker (Combobox + Listbox, ohne neue Abhängigkeit). Die Auswahl
 * ändert sich nur durch ausdrückliches Wählen – Tippen im Suchfeld oder Pfeiltasten tun nichts.
 * Enter wählt nur eine mit den Pfeiltasten angesteuerte Zeile, nie stillschweigend die erste.
 */
export function ObjectPicker({
  objects,
  usage,
  selectedId,
  children,
  onSelect,
  t,
}: ObjectPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const listId = `${uid}-list`;

  const groups = useMemo(
    () => groupObjectsForPicker({ objects, usage, query }),
    [objects, usage, query],
  );

  function close(returnFocus: boolean) {
    setOpen(false);
    setQuery("");
    setActive(-1);
    if (returnFocus) triggerRef.current?.focus();
  }

  // Escape schließt nur den Picker – nicht den ganzen Dialog (der hört in der Capture-Phase).
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (!panelRef.current?.contains(event.target as Node)) return;
      event.stopPropagation();
      event.preventDefault();
      close(true);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  function choose(id: string) {
    onSelect(id);
    close(true);
  }

  function onSearchKey(event: React.KeyboardEvent<HTMLInputElement>) {
    const count = groups.flat.length;
    if (event.key === "ArrowDown" && count > 0) {
      event.preventDefault();
      setActive((i) => (i + 1) % count);
    } else if (event.key === "ArrowUp" && count > 0) {
      event.preventDefault();
      setActive((i) => (i <= 0 ? count - 1 : i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = active >= 0 ? groups.flat[active] : undefined;
      if (picked) choose(picked.id);
    }
  }

  let index = -1;
  function renderGroup(key: string, label: string, items: WorkObject[]) {
    if (items.length === 0) return null;
    const headingId = `${uid}-${key}`;
    return (
      <div key={key} role="group" aria-labelledby={headingId} data-testid={`object-group-${key}`}>
        <p
          id={headingId}
          className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {label}
        </p>
        {items.map((o) => {
          index += 1;
          const optionIndex = index;
          const selected = o.id === selectedId;
          const address = objectAddressPreview(o);
          return (
            <div
              key={o.id}
              id={`${uid}-opt-${o.id}`}
              role="option"
              aria-selected={selected}
              data-testid={`object-option-${o.id}`}
              data-active={optionIndex === active ? "true" : undefined}
              onClick={() => choose(o.id)}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-left",
                optionIndex === active ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{o.name}</span>
                {address ? (
                  <span className="block truncate text-xs text-muted-foreground">{address}</span>
                ) : null}
              </span>
              {selected ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : null}
            </div>
          );
        })}
      </div>
    );
  }

  const activeId =
    active >= 0 && groups.flat[active] ? `${uid}-opt-${groups.flat[active]!.id}` : undefined;

  return (
    <div data-testid="object-picker">
      <button
        ref={triggerRef}
        type="button"
        data-testid="object-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? close(false) : setOpen(true))}
        className="relative block w-full rounded-2xl bg-card px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="sr-only">{t("object.select")}: </span>
        {children}
        <ChevronDown
          className={cn(
            "absolute right-3 top-4 size-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          ref={panelRef}
          data-testid="object-picker-panel"
          className="mt-1 overflow-hidden rounded-2xl border bg-card"
        >
          <div className="border-b p-2">
            <Input
              ref={searchRef}
              type="search"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              {...(activeId ? { "aria-activedescendant": activeId } : {})}
              aria-label={t("object.pickerSearch")}
              placeholder={t("object.pickerSearch")}
              data-testid="object-search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(-1);
              }}
              onKeyDown={onSearchKey}
              className="h-11 text-base"
            />
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label={t("object.select")}
            className="max-h-64 overflow-y-auto overscroll-contain pb-1"
          >
            {objects.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground" data-testid="object-empty">
                {t("object.empty")}
              </p>
            ) : groups.flat.length === 0 ? (
              <p
                className="px-3 py-3 text-sm text-muted-foreground"
                data-testid="object-no-results"
              >
                {t("object.pickerNoResults")}
              </p>
            ) : (
              <>
                {renderGroup("last", t("object.groupLast"), groups.last ? [groups.last] : [])}
                {renderGroup("frequent", t("object.groupFrequent"), groups.frequent)}
                {renderGroup("all", t("object.groupAll"), groups.all)}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
