"use client";

import {
  Children,
  createContext,
  createElement,
  useContext,
  useRef,
  type CSSProperties,
  type ComponentProps,
  type ElementType,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
  forwardRef,
} from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert as ShadcnAlert } from "@/components/ui/alert";
import { Badge as ShadcnBadge } from "@/components/ui/badge";
import { Button as ShadcnButton } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HoverCard as ShadcnHoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Progress as ShadcnProgress } from "@/components/ui/progress";
import { ScrollArea as ShadcnScrollArea } from "@/components/ui/scroll-area";
import {
  Select as ShadcnSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table as ShadcnTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs as ShadcnTabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea as ShadcnTextarea } from "@/components/ui/textarea";
import {
  Tooltip as ShadcnTooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Space = string | number | Record<string, string | number | undefined>;

const spaceScale: Record<string, string> = {
  xs: "0.375rem",
  sm: "0.625rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
};

function space(value: Space | undefined): string | number | undefined {
  if (value == null) return undefined;
  if (typeof value === "object") return space(value.base ?? Object.values(value)[0]);
  return typeof value === "string" ? (spaceScale[value] ?? value) : value;
}

function colorClass(color?: string) {
  if (!color || color === "dark") return "text-foreground";
  if (color === "dimmed" || color === "gray") return "text-muted-foreground";
  if (color === "red") return "text-destructive";
  if (color === "green") return "text-success";
  if (color === "orange" || color === "yellow") return "text-warning";
  return "text-primary";
}

function layoutStyle({
  m,
  mt,
  mb,
  ml,
  mr,
  mx,
  my,
  p,
  pt,
  pb,
  pl,
  pr,
  px,
  py,
  w,
  h,
  maw,
  miw,
  mih,
}: {
  m?: Space;
  mt?: Space;
  mb?: Space;
  ml?: Space;
  mr?: Space;
  mx?: Space;
  my?: Space;
  p?: Space;
  pt?: Space;
  pb?: Space;
  pl?: Space;
  pr?: Space;
  px?: Space;
  py?: Space;
  w?: string | number;
  h?: string | number;
  maw?: string | number;
  miw?: string | number;
  mih?: string | number;
}): CSSProperties {
  return {
    margin: space(m),
    marginTop: space(mt ?? my),
    marginBottom: space(mb ?? my),
    marginLeft: space(ml ?? mx),
    marginRight: space(mr ?? mx),
    padding: space(p),
    paddingTop: space(pt ?? py),
    paddingBottom: space(pb ?? py),
    paddingLeft: space(pl ?? px),
    paddingRight: space(pr ?? px),
    width: w,
    height: h,
    maxWidth: maw,
    minWidth: miw,
    minHeight: mih,
  };
}

type LayoutProps = HTMLAttributes<HTMLElement> & {
  component?: ElementType;
  m?: Space;
  mt?: Space;
  mb?: Space;
  ml?: Space;
  mr?: Space;
  mx?: Space;
  my?: Space;
  p?: Space;
  pt?: Space;
  pb?: Space;
  pl?: Space;
  pr?: Space;
  px?: Space;
  py?: Space;
  w?: string | number;
  h?: string | number;
  maw?: string | number;
  miw?: string | number;
  mih?: string | number;
  bg?: string;
  bd?: string;
  display?: CSSProperties["display"];
  c?: string;
  ta?: CSSProperties["textAlign"];
  ff?: CSSProperties["fontFamily"];
  fz?: Space;
};

export const Box = forwardRef<HTMLElement, LayoutProps>(function Box({ component = "div", className, style, bg, bd, display, c, ta, ff, fz, ...props }, ref) {
  const spacing = layoutStyle(props);
  const { m, mt, mb, ml, mr, mx, my, p, pt, pb, pl, pr, px, py, w, h, maw, miw, mih, ...domProps } = props;
  void m; void mt; void mb; void ml; void mr; void mx; void my; void p; void pt; void pb; void pl; void pr; void px; void py; void w; void h; void maw; void miw; void mih;
  return createElement(component, {
    ref,
    ...domProps,
    className: cn(bg === "white" ? "bg-card" : bg ? "bg-muted" : undefined, bd ? "border" : undefined, c ? colorClass(c) : undefined, className),
    style: { ...spacing, display, textAlign: ta, fontFamily: ff, fontSize: space(fz), ...style },
  });
});

type FlexProps = Omit<LayoutProps, "component"> & {
  component?: ElementType;
  gap?: Space;
  justify?: CSSProperties["justifyContent"];
  align?: CSSProperties["alignItems"];
  wrap?: CSSProperties["flexWrap"];
  grow?: boolean;
};

export function Group({ component = "div", className, style, gap = "sm", justify, align = "center", wrap = "wrap", grow, ...props }: FlexProps) {
  const spacing = layoutStyle(props);
  const { m, mt, mb, ml, mr, mx, my, p, pt, pb, pl, pr, px, py, w, h, maw, miw, mih, bg, bd, ...domProps } = props;
  void m; void mt; void mb; void ml; void mr; void mx; void my; void p; void pt; void pb; void pl; void pr; void px; void py; void w; void h; void maw; void miw; void mih; void bg; void bd;
  return createElement(component, { ...domProps, className: cn("flex", grow && "[&>*]:flex-1", className), style: { gap: space(gap), justifyContent: justify, alignItems: align, flexWrap: wrap, ...spacing, ...style } });
}

export function Stack({ className, style, gap = "sm", ...props }: FlexProps) {
  const spacing = layoutStyle(props);
  const { m, mt, mb, ml, mr, mx, my, p, pt, pb, pl, pr, px, py, w, h, maw, miw, mih, bg, bd, justify, align, wrap, grow, ...domProps } = props;
  void m; void mt; void mb; void ml; void mr; void mx; void my; void p; void pt; void pb; void pl; void pr; void px; void py; void w; void h; void maw; void miw; void mih; void bg; void bd; void grow;
  return <div {...domProps} className={cn("flex flex-col", className)} style={{ gap: space(gap), justifyContent: justify, alignItems: align, flexWrap: wrap, ...spacing, ...style }} />;
}

export function Center({ className, ...props }: LayoutProps) {
  return <Box {...props} className={cn("flex items-center justify-center", className)} />;
}

export function SimpleGrid({ cols = 1, spacing = "md", className, style, ...props }: LayoutProps & { cols?: number | Record<string, number>; spacing?: Space }) {
  const count = typeof cols === "number" ? cols : (cols.base ?? Object.values(cols)[0] ?? 1);
  return <Box {...props} className={cn("grid", className)} style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`, gap: space(spacing), ...style }} />;
}

export function Divider({ className, orientation, my, ...props }: HTMLAttributes<HTMLHRElement> & { orientation?: "horizontal" | "vertical"; my?: Space }) {
  return <hr {...props} className={cn("border-0", orientation === "vertical" ? "h-5 border-l" : "border-t", className)} style={{ marginTop: space(my), marginBottom: space(my), ...props.style }} />;
}

type TextProps = HTMLAttributes<HTMLElement> & {
  component?: ElementType;
  size?: "xs" | "sm" | "md" | "lg" | string;
  fw?: number;
  c?: string;
  truncate?: boolean;
  ta?: "left" | "center" | "right";
  fz?: Space;
  visibleFrom?: string;
  hiddenFrom?: string;
  m?: Space;
  mt?: Space;
  mb?: Space;
  ml?: Space;
  mr?: Space;
  mx?: Space;
  my?: Space;
  p?: Space;
  pt?: Space;
  pb?: Space;
  pl?: Space;
  pr?: Space;
  px?: Space;
  py?: Space;
  bd?: string;
  href?: string;
  lineClamp?: number;
  lh?: string | number;
  tt?: CSSProperties["textTransform"];
  ff?: CSSProperties["fontFamily"];
  display?: CSSProperties["display"];
  bg?: string;
  maw?: string | number;
  miw?: string | number;
  type?: "button" | "submit" | "reset";
};

export function Text({ component = "p", className, style, size, fw, c, truncate, ta, fz, visibleFrom, hiddenFrom, bd, lineClamp, lh, tt, ff, display, bg, maw, miw, m, mt, mb, ml, mr, mx, my, p, pt, pb, pl, pr, px, py, ...props }: TextProps) {
  const spacing = layoutStyle({ m, mt, mb, ml, mr, mx, my, p, pt, pb, pl, pr, px, py });
  const responsive = visibleFrom ? "hidden sm:block" : hiddenFrom ? "sm:hidden" : undefined;
  return createElement(component, {
    ...props,
    className: cn(size === "xs" ? "text-xs" : size === "lg" ? "text-lg" : "text-sm", colorClass(c), truncate && "truncate", lineClamp && `line-clamp-${Math.min(lineClamp, 6)}`, bd && "border-l", bg && "bg-muted", responsive, className),
    style: { fontWeight: fw, textAlign: ta, fontSize: space(fz), lineHeight: lh, textTransform: tt, fontFamily: ff, display, maxWidth: maw, minWidth: miw, ...spacing, ...style },
  });
}

export function Title({ order = 2, className, ...props }: Omit<TextProps, "component"> & { order?: 1 | 2 | 3 | 4 | 5 | 6 }) {
  return <Text component={`h${order}`} {...props} className={cn(order === 1 ? "text-2xl" : order === 2 ? "text-xl" : order === 3 ? "text-lg" : "text-base", "font-semibold tracking-tight", className)} />;
}

export function Paper({ withBorder, shadow, radius, className, ...props }: LayoutProps & { withBorder?: boolean; shadow?: string; radius?: string | number }) {
  void shadow; void radius;
  return <Box {...props} className={cn("rounded-xl bg-card", withBorder && "border", className)} />;
}

export function Card({ padding, ...props }: LayoutProps & { withBorder?: boolean; shadow?: string; radius?: string | number; padding?: Space }) {
  return <Paper {...props} p={padding ?? props.p} />;
}

export function ThemeIcon({ className, variant, radius, size, ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: string; radius?: string; size?: string | number }) {
  void variant; void radius;
  return <span {...props} className={cn("inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground", className)} style={{ width: space(size), height: space(size), ...props.style }} />;
}

type LegacyButtonProps = Omit<ComponentProps<"button">, "color"> & {
  component?: ElementType;
  href?: string;
  variant?: "filled" | "light" | "subtle" | "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
  color?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "compact-sm" | "compact-md" | "icon";
  leftSection?: ReactNode;
  rightSection?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  justify?: CSSProperties["justifyContent"];
  m?: Space; mt?: Space; mb?: Space; ml?: Space; mr?: Space; mx?: Space; my?: Space; p?: Space; px?: Space; py?: Space;
};
export function Button({ component, href, variant, color, size, leftSection, rightSection, loading, fullWidth, justify, className, children, style, m, mt, mb, ml, mr, mx, my, p, px, py, ...props }: LegacyButtonProps) {
  const resolved = color === "red" ? "destructive" : variant === "light" ? "secondary" : variant === "subtle" ? "ghost" : variant === "default" ? "outline" : variant;
  const resolvedSize = size === "xs" || size === "compact-sm" ? "sm" : size === "compact-md" ? "icon" : size === "xl" ? "lg" : size === "md" ? "default" : size;
  const content = <>{loading ? <LoaderCircle className="animate-spin" /> : leftSection}{children}{rightSection}</>;
  const spacingStyle = { ...layoutStyle({ m, mt, mb, ml, mr, mx, my, p, px, py }), justifyContent: justify, ...style };
  if (component) return <ShadcnButton asChild className={cn(fullWidth && "w-full", className)} variant={resolved as ComponentProps<typeof ShadcnButton>["variant"]} size={resolvedSize as ComponentProps<typeof ShadcnButton>["size"]} style={spacingStyle}>{createElement(component, { href, ...props }, content)}</ShadcnButton>;
  return <ShadcnButton {...props} className={cn(fullWidth && "w-full", className)} variant={resolved as ComponentProps<typeof ShadcnButton>["variant"]} size={resolvedSize as ComponentProps<typeof ShadcnButton>["size"]} style={spacingStyle} disabled={props.disabled || loading}>{content}</ShadcnButton>;
}

export function ActionIcon({ variant, color, size, className, children, hiddenFrom, ...props }: LegacyButtonProps & { hiddenFrom?: string }) {
  return <Button {...props} color={color} variant={variant ?? "ghost"} size="icon" className={cn(size === "sm" ? "size-8" : "size-9", hiddenFrom && "lg:hidden", className)}>{children}</Button>;
}

export function UnstyledButton({ className, ...props }: ComponentProps<"button"> & { visibleFrom?: string; hiddenFrom?: string; c?: string; fz?: string; fw?: number; w?: string | number; p?: Space }) {
  const { visibleFrom, hiddenFrom, c, fz, fw, w, p, style, ...buttonProps } = props;
  return <button {...buttonProps} type={buttonProps.type ?? "button"} className={cn("inline-flex items-center text-sm", colorClass(c), visibleFrom && "hidden sm:inline-flex", hiddenFrom && "sm:hidden", className)} style={{ fontSize: space(fz), fontWeight: fw, width: w, padding: space(p), ...style }} />;
}

export function Anchor({ component = "a", className, c, fw, ...props }: TextProps) {
  return <Text component={component} {...props} c={c} fw={fw} className={cn("transition-colors hover:text-primary hover:underline", className)} />;
}

export function Alert({ title, icon, color, className, children, m, mt, mb, ml, mr, mx, my, withCloseButton, onClose, ...props }: HTMLAttributes<HTMLDivElement> & { title?: ReactNode; icon?: ReactNode; color?: string; m?: Space; mt?: Space; mb?: Space; ml?: Space; mr?: Space; mx?: Space; my?: Space; withCloseButton?: boolean; onClose?: () => void }) {
  return <ShadcnAlert {...props} variant={color === "red" ? "destructive" : "default"} className={className} style={{ ...layoutStyle({ m, mt, mb, ml, mr, mx, my }), ...props.style }}>{icon}{title ? <p className="font-medium">{title}</p> : null}<div className="text-sm leading-6">{children}</div>{withCloseButton ? <button type="button" onClick={onClose} className="absolute right-3 top-3">×<span className="sr-only">关闭</span></button> : null}</ShadcnAlert>;
}

export function Badge({ color, variant, className, leftSection, size, mt, style, ...props }: Omit<ComponentProps<typeof ShadcnBadge>, "variant"> & { color?: string; variant?: "filled" | "light" | "dot" | "outline" | "secondary" | "default" | "destructive"; leftSection?: ReactNode; size?: string; mt?: Space }) {
  void size;
  const tone = color === "red" ? "destructive" : color === "green" ? "secondary" : variant;
  const resolved = tone === "light" ? "secondary" : tone === "dot" ? "outline" : tone === "filled" ? "default" : tone;
  return <ShadcnBadge {...props} variant={resolved as ComponentProps<typeof ShadcnBadge>["variant"]} className={cn(color === "green" && "border-success/20 bg-success-soft text-success", color === "orange" && "border-warning/20 bg-warning-soft text-warning", variant === "dot" && "before:size-1.5 before:rounded-full before:bg-current", className)} style={{ marginTop: space(mt), ...style }}>{leftSection}{props.children}</ShadcnBadge>;
}

export function Loader({ size = 16, className }: { size?: number | string; className?: string; color?: string }) {
  const resolved = typeof size === "number" ? size : size === "sm" ? 16 : size === "lg" ? 24 : 20;
  return <LoaderCircle className={cn("animate-spin", className)} style={{ width: resolved, height: resolved }} aria-label="加载中" />;
}

export function TextInput({ label, description, error, leftSection, rightSection, className, style, w, maw, miw, size, m, mt, mb, ml, mr, mx, my, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { label?: ReactNode; description?: ReactNode; error?: ReactNode; leftSection?: ReactNode; rightSection?: ReactNode; w?: string | number; maw?: string | number; miw?: string | number; size?: string; m?: Space; mt?: Space; mb?: Space; ml?: Space; mr?: Space; mx?: Space; my?: Space }) {
  void size;
  return <label className={cn("grid gap-1.5 text-sm font-medium", className)} style={{ width: w, maxWidth: maw, minWidth: miw, ...layoutStyle({ m, mt, mb, ml, mr, mx, my }), ...style }}>{label}{description ? <span className="text-xs font-normal text-muted-foreground">{description}</span> : null}<span className="relative block">{leftSection ? <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">{leftSection}</span> : null}<Input {...props} className={cn(leftSection && "pl-8", rightSection && "pr-8")} />{rightSection ? <span className="absolute right-2.5 top-1/2 -translate-y-1/2">{rightSection}</span> : null}</span>{error ? <span className="text-xs font-normal text-destructive">{error}</span> : null}</label>;
}

export function Textarea({ label, description, error, className, style, minRows, maxRows, autosize, styles, m, mt, mb, ml, mr, mx, my, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; description?: ReactNode; error?: ReactNode; minRows?: number; maxRows?: number; autosize?: boolean; styles?: unknown; m?: Space; mt?: Space; mb?: Space; ml?: Space; mr?: Space; mx?: Space; my?: Space }) {
  void autosize; void styles;
  return <label className={cn("grid gap-1.5 text-sm font-medium", className)} style={{ ...layoutStyle({ m, mt, mb, ml, mr, mx, my }), ...style }}>{label}{description ? <span className="text-xs font-normal text-muted-foreground">{description}</span> : null}<ShadcnTextarea {...props} rows={minRows ?? props.rows} style={{ maxHeight: maxRows ? `${maxRows * 1.5}rem` : undefined }} />{error ? <span className="text-xs font-normal text-destructive">{error}</span> : null}</label>;
}

type Option = { value: string; label: string; disabled?: boolean };
export function Select({ label, description, data = [], value, defaultValue, onChange, placeholder, searchable, clearable, disabled, className, w }: { label?: ReactNode; description?: ReactNode; data?: Option[] | string[]; value?: string | null; defaultValue?: string; onChange?: (value: string | null) => void; placeholder?: string; searchable?: boolean; clearable?: boolean; disabled?: boolean; required?: boolean; className?: string; w?: string | number; size?: string }) {
  void searchable; void clearable;
  const options = data.map((item) => typeof item === "string" ? { value: item, label: item } : item);
  return <label className={cn("grid gap-1.5 text-sm font-medium", className)} style={{ width: w }}>{label}{description ? <span className="text-xs font-normal text-muted-foreground">{description}</span> : null}<ShadcnSelect value={value ?? undefined} defaultValue={defaultValue} onValueChange={(next) => onChange?.(next)} disabled={disabled}><SelectTrigger className="w-full"><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent>{options.map((item) => <SelectItem key={item.value} value={item.value} disabled={item.disabled}>{item.label}</SelectItem>)}</SelectContent></ShadcnSelect></label>;
}

export function Progress({ value = 0, size, mt, color, ...props }: ComponentProps<typeof ShadcnProgress> & { size?: string; mt?: Space; color?: string }) {
  void size;
  void color;
  return <ShadcnProgress {...props} value={value} style={{ marginTop: space(mt), ...props.style }} />;
}

export function ScrollArea({ h, mah, className, m, mt, mb, ml, mr, mx, my, p, pt, pb, pl, pr, px, py, bg, ...props }: ComponentProps<typeof ShadcnScrollArea> & { h?: string | number; mah?: string | number; m?: Space; mt?: Space; mb?: Space; ml?: Space; mr?: Space; mx?: Space; my?: Space; p?: Space; pt?: Space; pb?: Space; pl?: Space; pr?: Space; px?: Space; py?: Space; bg?: string }) {
  return <ShadcnScrollArea {...props} className={cn(bg && "bg-muted", className)} style={{ height: h, maxHeight: mah, ...layoutStyle({ m, mt, mb, ml, mr, mx, my, p, pt, pb, pl, pr, px, py }), ...props.style }} />;
}

export function Modal({ opened, onClose, title, children, size, centered, ...props }: { opened: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; size?: string; centered?: boolean; [key: string]: unknown }) {
  void centered;
  return <Dialog open={opened} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className={cn(size === "lg" ? "sm:max-w-2xl" : size === "xl" ? "sm:max-w-4xl" : "sm:max-w-lg")} {...(props as ComponentProps<typeof DialogContent>)}><DialogHeader>{title ? <DialogTitle>{title}</DialogTitle> : null}<DialogDescription className="sr-only">ProjectAI 操作对话框</DialogDescription></DialogHeader>{children}</DialogContent></Dialog>;
}

export function Drawer({ opened, onClose, title, children, position = "right", size, ...props }: { opened: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; position?: "left" | "right" | "top" | "bottom"; size?: string | number; [key: string]: unknown }) {
  void size;
  return <Sheet open={opened} onOpenChange={(open) => { if (!open) onClose(); }}><SheetContent side={position} className={position === "bottom" ? "max-h-[85vh]" : "w-full sm:max-w-xl"} {...(props as ComponentProps<typeof SheetContent>)}><SheetHeader>{title ? <SheetTitle>{title}</SheetTitle> : null}<SheetDescription className="sr-only">ProjectAI 详情面板</SheetDescription></SheetHeader><div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div></SheetContent></Sheet>;
}

export function Tooltip({ label, children, ...props }: { label: ReactNode; children: ReactNode; [key: string]: unknown }) {
  return <ShadcnTooltip {...props}><TooltipTrigger asChild>{children as ReactElement}</TooltipTrigger><TooltipContent>{label}</TooltipContent></ShadcnTooltip>;
}

function HoverCardRoot({ children, openDelay, width, shadow, onOpen }: { children: ReactNode; openDelay?: number; width?: number; shadow?: string; onOpen?: () => void }) {
  void width; void shadow;
  return <ShadcnHoverCard openDelay={openDelay} onOpenChange={(open) => { if (open) onOpen?.(); }}>{children}</ShadcnHoverCard>;
}
function HoverCardTarget({ children }: { children: ReactNode }) { return <HoverCardTrigger asChild>{children as ReactElement}</HoverCardTrigger>; }
function HoverCardDropdown({ children }: { children: ReactNode }) { return <HoverCardContent>{children}</HoverCardContent>; }
export const HoverCard = Object.assign(HoverCardRoot, { Target: HoverCardTarget, Dropdown: HoverCardDropdown });

function MenuRoot({ children, position, shadow, width, withinPortal }: { children: ReactNode; position?: string; shadow?: string; width?: number; withinPortal?: boolean }) { void position; void shadow; void width; void withinPortal; return <DropdownMenu>{children}</DropdownMenu>; }
function MenuTarget({ children }: { children: ReactNode }) { return <DropdownMenuTrigger asChild>{children as ReactElement}</DropdownMenuTrigger>; }
function MenuDropdown({ children }: { children: ReactNode }) { return <DropdownMenuContent align="end">{children}</DropdownMenuContent>; }
function MenuItem({ children, color, leftSection, onClick, disabled, ...props }: { children: ReactNode; color?: string; leftSection?: ReactNode; onClick?: () => void; disabled?: boolean; [key: string]: unknown }) { return <DropdownMenuItem {...(props as ComponentProps<typeof DropdownMenuItem>)} variant={color === "red" ? "destructive" : "default"} onClick={onClick} disabled={disabled}>{leftSection}{children}</DropdownMenuItem>; }
export const Menu = Object.assign(MenuRoot, { Target: MenuTarget, Dropdown: MenuDropdown, Item: MenuItem, Divider: DropdownMenuSeparator });

function BreadcrumbsRoot({ children, separator = "/", className, fz, m, mt, mb, ml, mr, mx, my, ...props }: HTMLAttributes<HTMLElement> & { separator?: ReactNode; fz?: Space; m?: Space; mt?: Space; mb?: Space; ml?: Space; mr?: Space; mx?: Space; my?: Space }) {
  const items = Children.toArray(children);
  return <nav {...props} className={cn("flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground", className)} style={{ fontSize: space(fz), ...layoutStyle({ m, mt, mb, ml, mr, mx, my }), ...props.style }}>{items.map((item, index) => <span key={index} className="inline-flex min-w-0 items-center gap-1.5">{item}{index < items.length - 1 ? <span aria-hidden>{separator}</span> : null}</span>)}</nav>;
}
export const Breadcrumbs = BreadcrumbsRoot;

function TabsRoot({ value, onChange, children, className, mt }: { value?: string | null; onChange?: (value: string | null) => void; children: ReactNode; className?: string; mt?: Space; variant?: string }) {
  return <ShadcnTabs value={value ?? undefined} onValueChange={(next) => onChange?.(next)} className={className} style={{ marginTop: space(mt) }}>{children}</ShadcnTabs>;
}
function TabsListCompat({ children, className }: { children: ReactNode; className?: string }) { return <TabsList className={className}>{children}</TabsList>; }
function TabsTab({ value, children, component, href }: { value: string; children: ReactNode; component?: ElementType; href?: string }) {
  if (component && href) return <TabsTrigger value={value} asChild>{createElement(component, { href }, children)}</TabsTrigger>;
  return <TabsTrigger value={value}>{children}</TabsTrigger>;
}
export const Tabs = Object.assign(TabsRoot, { List: TabsListCompat, Tab: TabsTab });

function TableRoot({ striped, highlightOnHover, verticalSpacing, className, miw, ...props }: ComponentProps<typeof ShadcnTable> & { striped?: boolean; highlightOnHover?: boolean; verticalSpacing?: string; miw?: string | number }) { void verticalSpacing; return <ShadcnTable {...props} className={cn(striped && "[&_tbody_tr:nth-child(even)]:bg-muted/30", highlightOnHover && "[&_tbody_tr]:hover:bg-muted/50", className)} style={{ minWidth: miw, ...props.style }} />; }
function TableHeaderCell({ w, className, ...props }: ComponentProps<typeof TableHead> & { w?: string | number }) { return <TableHead {...props} className={className} style={{ width: w, ...props.style }} />; }
function TableData({ fw, className, ...props }: ComponentProps<typeof TableCell> & { fw?: number }) { return <TableCell {...props} className={className} style={{ fontWeight: fw, ...props.style }} />; }
function TableRowCompat({ bg, className, ...props }: ComponentProps<typeof TableRow> & { bg?: string }) { return <TableRow {...props} className={cn(bg && "bg-muted", className)} />; }
function TableScrollContainer({ children, minWidth }: { children: ReactNode; minWidth?: number }) { return <div className="overflow-x-auto"><div style={{ minWidth }}>{children}</div></div>; }
export const Table = Object.assign(TableRoot, { Thead: TableHeader, Tbody: TableBody, Tr: TableRowCompat, Th: TableHeaderCell, Td: TableData, ScrollContainer: TableScrollContainer });

export function SegmentedControl({ data, value, onChange, fullWidth }: { data: Array<string | { value: string; label: ReactNode }>; value: string; onChange: (value: string) => void; fullWidth?: boolean; size?: string }) {
  return <div className={cn("inline-flex rounded-lg bg-muted p-1", fullWidth && "w-full")}>{data.map((item) => { const option = typeof item === "string" ? { value: item, label: item } : item; return <button key={option.value} type="button" onClick={() => onChange(option.value)} className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition-colors", fullWidth && "flex-1", value === option.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{option.label}</button>; })}</div>;
}

export function Checkbox({ checked, onChange, label, disabled, ...props }: { checked?: boolean; onChange?: (event: { currentTarget: { checked: boolean } }) => void; label?: ReactNode; disabled?: boolean; [key: string]: unknown }) {
  return <label className="inline-flex items-center gap-2 text-sm"><input {...(props as InputHTMLAttributes<HTMLInputElement>)} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange?.({ currentTarget: { checked: event.currentTarget.checked } })} className="size-4 accent-primary" />{label}</label>;
}

type RadioContextValue = { value?: string; onChange?: (value: string) => void };
const RadioContext = createContext<RadioContextValue>({});
function RadioGroup({ value, onChange, children, mt }: { value?: string; onChange?: (value: string) => void; children: ReactNode; mt?: Space }) { return <RadioContext.Provider value={{ value, onChange }}><div className="grid gap-2" style={{ marginTop: space(mt) }}>{children}</div></RadioContext.Provider>; }
function RadioItem({ value, label }: { value: string; label?: ReactNode }) { const group = useContext(RadioContext); return <label className="inline-flex items-center gap-2 text-sm"><input type="radio" checked={group.value === value} onChange={() => group.onChange?.(value)} className="size-4 accent-primary" />{label}</label>; }
export const Radio = Object.assign(RadioItem, { Group: RadioGroup });

export function Image({ src, alt = "", className, mah, radius, fit, ...props }: ComponentProps<"img"> & { mah?: string | number; radius?: string; fit?: CSSProperties["objectFit"] }) {
  // Compatibility wrapper preserves dynamic signed preview sizes; callers do not know image dimensions up front.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={cn(radius && "rounded-lg", className)} style={{ maxHeight: mah, objectFit: fit, ...props.style }} {...props} />;
}

export function Avatar({ children, color, radius, size, className, ...props }: HTMLAttributes<HTMLDivElement> & { color?: string; radius?: string; size?: string | number }) {
  void color; void radius;
  return <div {...props} className={cn("grid shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary", className)} style={{ width: space(size ?? 36), height: space(size ?? 36), ...props.style }}>{children}</div>;
}

export function NavLink({ component = "a", label, leftSection, rightSection, active, className, ...props }: { component?: ElementType; label: ReactNode; leftSection?: ReactNode; rightSection?: ReactNode; active?: boolean; className?: string; [key: string]: unknown }) {
  return createElement(component, { ...props, className: cn("flex h-9 items-center gap-2 rounded-lg px-3 text-sm transition-colors", active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground", className) }, leftSection, <span className="min-w-0 flex-1 truncate">{label}</span>, rightSection);
}

export function Dropzone({ onDrop, accept, maxSize, multiple = true, children, className, ...props }: { onDrop: (files: File[]) => void; accept?: string[] | Record<string, string[]>; maxSize?: number; multiple?: boolean; children: ReactNode; className?: string; [key: string]: unknown }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const acceptValue = Array.isArray(accept) ? accept.join(",") : accept ? Object.keys(accept).join(",") : undefined;
  const handle = (files: FileList | null) => {
    const selected = Array.from(files ?? []).filter((file) => !maxSize || file.size <= maxSize);
    if (selected.length) onDrop(selected);
  };
  return <div {...(props as HTMLAttributes<HTMLDivElement>)} role="button" tabIndex={0} onClick={() => inputRef.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); handle(event.dataTransfer.files); }} className={cn("rounded-xl border border-dashed bg-muted/30 p-6 text-center transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}><input ref={inputRef} type="file" multiple={multiple} accept={acceptValue} className="sr-only" tabIndex={-1} onChange={(event) => handle(event.currentTarget.files)} />{children}</div>;
}
