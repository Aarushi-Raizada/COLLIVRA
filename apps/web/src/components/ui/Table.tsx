import React from "react";
import { cn } from "@/lib/utils";

export const Table: React.FC<React.TableHTMLAttributes<HTMLTableElement>> = ({
  className,
  ...props
}) => (
  <div className="w-full overflow-x-auto">
    <table
      className={cn("w-full text-left text-xs border-collapse font-sans", className)}
      {...props}
    />
  </div>
);

export const TableHeader: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  className,
  ...props
}) => (
  <thead
    className={cn(
      "border-b border-space-border/80 bg-space-panel/60 font-sans text-[11px] uppercase tracking-wider text-slate-400 font-semibold",
      className
    )}
    {...props}
  />
);

export const TableBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  className,
  ...props
}) => (
  <tbody
    className={cn("divide-y divide-space-border/40 text-slate-200", className)}
    {...props}
  />
);

export const TableRow: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({
  className,
  ...props
}) => (
  <tr
    className={cn(
      "hover:bg-space-panel/50 transition-colors group cursor-pointer",
      className
    )}
    {...props}
  />
);

export const TableHead: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({
  className,
  ...props
}) => (
  <th
    className={cn("py-2.5 px-3.5 sm:px-4 font-sans font-semibold text-xs text-slate-300", className)}
    {...props}
  />
);

export const TableCell: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({
  className,
  ...props
}) => (
  <td
    className={cn("py-2.5 px-3.5 sm:px-4 text-xs font-sans text-slate-200", className)}
    {...props}
  />
);
