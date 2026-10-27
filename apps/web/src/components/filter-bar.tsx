"use client";

import { Search, SlidersHorizontal, ArrowUpDown, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

type Choice = { value: string; label: string };
type Selection = {
  value: string;
  options: Choice[];
  onChange: (value: string) => void;
};

export type FilterBarProps = {
  search?: {
    label: string;
    placeholder: string;
    value: string;
    maxLength?: number;
    onChange: (value: string) => void;
  };
  filters?: (Selection & { id: string; label: string; defaultValue: string })[];
  sort?: Selection;
  canClear: boolean;
  onClear: () => void;
};

export function FilterBar({ search, filters = [], sort, canClear, onClear }: FilterBarProps) {
  const activeFilters = filters.filter((filter) => filter.value !== filter.defaultValue);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-b border-border bg-card px-4 py-3">
      {search ? (
        <label className="relative w-full sm:w-64">
          <span className="sr-only">{search.label}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input value={search.value} maxLength={search.maxLength} onChange={(event) => search.onChange(event.target.value)} placeholder={search.placeholder} className="w-full pl-9" />
        </label>
      ) : null}
      {filters.length > 0 || sort || canClear ? (
        <div className="flex flex-wrap items-center gap-2">
          {filters.length > 0 ? (
            <div className="inline-flex items-center">
            <DropdownMenu>
              <DropdownMenuTrigger aria-label={`Filtros: ${activeFilters.length} activos`} render={<Button variant="outline" className={canClear ? "rounded-r-none border-r-0 pr-1" : undefined} />}>
                <SlidersHorizontal aria-hidden="true" />Filtros
                {activeFilters.length > 0 ? <Badge variant="secondary" aria-hidden="true">{activeFilters.length}</Badge> : null}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {filters.map((filter) => (
                  <DropdownMenuGroup key={filter.id}>
                    <DropdownMenuLabel>{filter.label}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={filter.value} onValueChange={(value) => filter.onChange(String(value))} aria-label={filter.label}>
                      {filter.options.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {canClear ? <Button type="button" variant="outline" size="icon" className="w-6 rounded-l-none border-l-0 p-0 [&_svg]:size-3" onClick={onClear} aria-label="Limpiar búsqueda y filtros" title="Limpiar búsqueda y filtros"><X aria-hidden="true" /></Button> : null}
            </div>
          ) : null}
          {filters.length === 0 && canClear ? <Button type="button" variant="outline" size="icon" onClick={onClear} aria-label="Limpiar búsqueda" title="Limpiar búsqueda"><X aria-hidden="true" /></Button> : null}
          {sort ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}><ArrowUpDown aria-hidden="true" />Ordenar</DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Ordenar por</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={sort.value} onValueChange={(value) => sort.onChange(String(value))} aria-label="Ordenar por">
                    {sort.options.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}
