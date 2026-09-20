import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";
import { isoDate } from "@/lib/minijob/calc";
import { deleteObject, newId, saveObject } from "@/lib/minijob/store";
import type { WorkObject } from "@/lib/minijob/types";

interface ObjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  object?: WorkObject | null;
  /** Called after save with the persisted object (for ShiftDialog apply). */
  onSaved?: (obj: WorkObject) => void;
}

export function ObjectDialog({ open, onOpenChange, object, onSaved }: ObjectDialogProps) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [street, setStreet] = useState("");
  const [houseNo, setHouseNo] = useState("");
  const [floor, setFloor] = useState("");
  const [doorSide, setDoorSide] = useState("");
  const [zip, setZip] = useState("");
  const [city, setCity] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(object?.name ?? "");
    setStreet(object?.street ?? "");
    setHouseNo(object?.houseNo ?? "");
    setFloor(object?.floor ?? "");
    setDoorSide(object?.doorSide ?? "");
    setZip(object?.zip ?? "");
    setCity(object?.city ?? "");
  }, [open, object]);

  function submit() {
    if (!name.trim()) {
      toast.error(t("object.nameRequired"));
      return;
    }
    const now = isoDate(new Date());
    const next: WorkObject = {
      id: object?.id ?? newId(),
      name: name.trim(),
      createdAt: object?.createdAt ?? now,
      updatedAt: now,
    };
    if (street.trim()) next.street = street.trim();
    if (houseNo.trim()) next.houseNo = houseNo.trim();
    if (floor.trim()) next.floor = floor.trim();
    if (doorSide.trim()) next.doorSide = doorSide.trim();
    if (zip.trim()) next.zip = zip.trim();
    if (city.trim()) next.city = city.trim();
    saveObject(next);
    toast.success(t("object.saveOk"));
    onSaved?.(next);
    onOpenChange(false);
  }

  function remove() {
    if (!object) return;
    deleteObject(object.id);
    toast.success(t("object.deleteOk"));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{object ? t("object.edit") : t("object.new")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="obj-name">{t("object.name")}</Label>
            <Input
              id="obj-name"
              value={name}
              placeholder={t("object.namePh")}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-[2fr_1fr] gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="obj-street" className="text-xs">
                {t("worklog.street")}
              </Label>
              <Input
                id="obj-street"
                value={street}
                placeholder={t("worklog.streetPlaceholder")}
                onChange={(e) => setStreet(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="obj-house" className="text-xs">
                {t("worklog.houseNo")}
              </Label>
              <Input
                id="obj-house"
                value={houseNo}
                placeholder="15"
                onChange={(e) => setHouseNo(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="obj-zip" className="text-xs">
                {t("worklog.zip")}
              </Label>
              <Input
                id="obj-zip"
                value={zip}
                inputMode="numeric"
                placeholder={t("worklog.zipPlaceholder")}
                onChange={(e) => setZip(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="obj-city" className="text-xs">
                {t("worklog.city")}
              </Label>
              <Input
                id="obj-city"
                value={city}
                placeholder={t("worklog.cityPlaceholder")}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="obj-floor" className="text-xs">
                {t("worklog.floor")}
              </Label>
              <Input
                id="obj-floor"
                value={floor}
                placeholder={t("worklog.floorPlaceholder")}
                onChange={(e) => setFloor(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="obj-door" className="text-xs">
                {t("worklog.doorSide")}
              </Label>
              <Input
                id="obj-door"
                value={doorSide}
                placeholder={t("worklog.doorSidePlaceholder")}
                onChange={(e) => setDoorSide(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {object ? (
            <Button type="button" variant="destructive" onClick={remove}>
              <Trash2 className="size-4" /> {t("object.delete")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("action.cancel")}
            </Button>
            <Button type="button" onClick={submit}>
              {t("object.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
