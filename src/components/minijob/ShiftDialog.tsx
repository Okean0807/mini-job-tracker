import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatEuro, formatHours, shiftEarnings, shiftHours } from "@/lib/minijob/calc";
import { deleteShift, newId, saveShift } from "@/lib/minijob/store";
import type { Shift } from "@/lib/minijob/types";

interface ShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  shift?: Shift | null;
  defaultRate: number;
}

export function ShiftDialog({ open, onOpenChange, date, shift, defaultRate }: ShiftDialogProps) {
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("13:00");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [rate, setRate] = useState(String(defaultRate));
  const [note, setNote] = useState("");
  const [day, setDay] = useState(date);

  useEffect(() => {
    if (!open) return;
    setDay(shift?.date ?? date);
    setStart(shift?.start ?? "09:00");
    setEnd(shift?.end ?? "13:00");
    setBreakMinutes(String(shift?.breakMinutes ?? 0));
    setRate(String(shift?.rate ?? defaultRate));
    setNote(shift?.note ?? "");
  }, [open, shift, date, defaultRate]);

  const preview: Shift = {
    id: shift?.id ?? "preview",
    date: day,
    start,
    end,
    breakMinutes: Number(breakMinutes) || 0,
    rate: Number(rate.replace(",", ".")) || 0,
  };

  function handleSave() {
    if (!day || !start || !end) {
      toast.error("Bitte Datum, Beginn und Ende ausfüllen.");
      return;
    }
    if (shiftHours(preview) <= 0) {
      toast.error("Die Arbeitszeit muss größer als 0 sein.");
      return;
    }
    saveShift({
      id: shift?.id ?? newId(),
      date: day,
      start,
      end,
      breakMinutes: Number(breakMinutes) || 0,
      rate: Number(rate.replace(",", ".")) || 0,
      note: note.trim() || undefined,
    });
    toast.success(shift ? "Schicht aktualisiert" : "Schicht gespeichert");
    onOpenChange(false);
  }

  function handleDelete() {
    if (!shift) return;
    deleteShift(shift.id);
    toast.success("Schicht gelöscht");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>{shift ? "Schicht bearbeiten" : "Neue Schicht"}</DialogTitle>
          <DialogDescription>Arbeitszeiten und Stundenlohn erfassen.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="datum">Datum</Label>
            <Input id="datum" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="beginn">Beginn</Label>
              <Input
                id="beginn"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ende">Ende</Label>
              <Input id="ende" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="pause">Pause (Min.)</Label>
              <Input
                id="pause"
                type="number"
                inputMode="numeric"
                min="0"
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="lohn">Stundenlohn (€)</Label>
              <Input
                id="lohn"
                type="number"
                inputMode="decimal"
                step="0.5"
                min="0"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="notiz">Notiz (optional)</Label>
            <Input
              id="notiz"
              value={note}
              placeholder="z. B. Spätschicht Filiale Mitte"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl bg-muted px-4 py-3 text-sm">
            <span className="text-muted-foreground">Ergebnis</span>
            <span className="font-semibold tabular-nums">
              {formatHours(shiftHours(preview))} · {formatEuro(shiftEarnings(preview))}
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {shift ? (
            <Button variant="ghost" onClick={handleDelete} className="text-destructive">
              <Trash2 className="size-4" /> Löschen
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={handleSave}>Speichern</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
