import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn as agentPayCn } from "@/lib/utils";

const agentPayButtonVariants = cva(
  "agent-pay-button rounded-full font-semibold shadow-sm transition-[background-color,border-color,box-shadow,color,transform] duration-300 ease-out",
  {
    variants: {
      variant: {
        primary:
          "agent-pay-button-primary-white",
        secondary:
          "secondary-action border border-border bg-card text-card-foreground hover:bg-secondary hover:text-secondary-foreground",
        ghost:
          "ghost-action bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
        icon:
          "icon-action size-10 rounded-full border border-border bg-card text-card-foreground hover:bg-secondary",
        explorer:
          "explorer-link rounded-md bg-transparent px-0 text-primary shadow-none hover:text-primary/80 hover:underline",
        nav:
          "hero-nav-link-control rounded-full bg-card/85 text-card-foreground shadow-sm backdrop-blur-md hover:bg-card"
      },
      size: {
        default: "h-10 px-4 py-2",
        hero: "hero-cta h-12 px-6 text-base",
        compact: "agent-pay-button-compact h-8 px-3 text-xs"
      }
    },
    defaultVariants: {
      variant: "secondary",
      size: "default"
    }
  }
);

type AgentPayButtonProps = Omit<ComponentPropsWithoutRef<typeof Button>, "size" | "variant"> &
  VariantProps<typeof agentPayButtonVariants>;

export const AgentPayButton = forwardRef<ElementRef<typeof Button>, AgentPayButtonProps>(
  ({ className, size, variant, ...props }, ref) => (
    <Button
      className={agentPayCn(agentPayButtonVariants({ size, variant }), className)}
      ref={ref}
      variant={variant === "ghost" || variant === "explorer" || variant === "primary" ? "ghost" : "secondary"}
      {...props}
    />
  )
);
AgentPayButton.displayName = "AgentPayButton";

type AgentPayBadgeProps = ComponentPropsWithoutRef<"span"> & { state?: "idle" | "running" | "payment_required" | "complete" | "error" };

export const AgentPayBadge = forwardRef<HTMLSpanElement, AgentPayBadgeProps>(
  ({ children, className, state = "idle", ...props }, ref) => {
    const chipClass = {
      idle: "aspect-chip--neutral",
      running: "aspect-chip--caution",
      payment_required: "aspect-chip--caution",
      complete: "aspect-chip--clear",
      error: "aspect-chip--danger",
    }[state ?? "idle"] ?? "aspect-chip--neutral";
    return (
      <span
        className={agentPayCn("agent-pay-badge aspect-chip", chipClass, className)}
        ref={ref}
        {...props}
      >
        {children}
      </span>
    );
  }
);
AgentPayBadge.displayName = "AgentPayBadge";

export const AgentPayCard = forwardRef<ElementRef<typeof Card>, ComponentPropsWithoutRef<typeof Card>>(
  ({ className, ...props }, ref) => (
    <Card className={agentPayCn("agent-pay-card panel border-border bg-card text-card-foreground", className)} ref={ref} {...props} />
  )
);
AgentPayCard.displayName = "AgentPayCard";

export const AgentPayCardHeader = forwardRef<ElementRef<typeof CardHeader>, ComponentPropsWithoutRef<typeof CardHeader>>(
  ({ className, ...props }, ref) => (
    <CardHeader className={agentPayCn("agent-pay-card-header panel-header", className)} ref={ref} {...props} />
  )
);
AgentPayCardHeader.displayName = "AgentPayCardHeader";

export const AgentPayCardIcon = forwardRef<HTMLSpanElement, ComponentPropsWithoutRef<"span">>(
  ({ className, ...props }, ref) => (
    <span
      className={agentPayCn("agent-pay-card-icon panel-icon border-border bg-secondary text-secondary-foreground", className)}
      ref={ref}
      {...props}
    />
  )
);
AgentPayCardIcon.displayName = "AgentPayCardIcon";

export const AgentPayInput = forwardRef<ElementRef<typeof Input>, ComponentPropsWithoutRef<typeof Input>>(
  ({ className, ...props }, ref) => (
    <Input className={agentPayCn("agent-pay-input bg-background", className)} ref={ref} {...props} />
  )
);
AgentPayInput.displayName = "AgentPayInput";

export const AgentPayTextarea = forwardRef<ElementRef<typeof Textarea>, ComponentPropsWithoutRef<typeof Textarea>>(
  ({ className, ...props }, ref) => (
    <Textarea className={agentPayCn("agent-pay-textarea bg-background", className)} ref={ref} {...props} />
  )
);
AgentPayTextarea.displayName = "AgentPayTextarea";

const agentPaySurfaceVariants = cva("agent-pay-surface border-border bg-card text-card-foreground", {
  variants: {
    variant: {
      default: "",
      connection: "agent-connection-panel",
      connectionActive: "agent-connection-panel connected",
      payment: "agent-pay-payment-sheet",
      readiness: "payment-readiness",
      source: "source-row",
      proof: "proof-row",
      receipt: "decision-receipt",
      record: "evidence-record"
    },
    state: {
      default: "",
      ready: "ready",
      configuration_required: "configuration_required",
      facilitator_unavailable: "facilitator_unavailable",
      facilitator_unsupported: "facilitator_unsupported",
      rpc_unavailable: "rpc_unavailable",
      payment_required: "payment_required",
      error: "error",
      missing: "missing",
      fail: "fail",
      pass: "pass"
    }
  },
  defaultVariants: {
    variant: "default",
    state: "default"
  }
});

type AgentPaySurfaceProps = ComponentPropsWithoutRef<"div"> &
  VariantProps<typeof agentPaySurfaceVariants> & {
    asChild?: boolean;
  };

export const AgentPaySurface = forwardRef<HTMLDivElement, AgentPaySurfaceProps>(
  ({ asChild = false, className, state, variant, ...props }, ref) => {
    const Component = asChild ? Slot : "div";

    return (
      <Component
        className={agentPayCn(agentPaySurfaceVariants({ state, variant }), className)}
        ref={ref}
        {...props}
      />
    );
  }
);
AgentPaySurface.displayName = "AgentPaySurface";

const agentPayAlertVariants = cva("", {
  variants: {
    variant: {
      error: "error-banner border-destructive/40 bg-destructive/10 text-destructive",
      notice: "notice-banner border-border bg-card text-card-foreground"
    }
  },
  defaultVariants: {
    variant: "notice"
  }
});

type AgentPayAlertProps = Omit<ComponentPropsWithoutRef<typeof Alert>, "variant"> &
  VariantProps<typeof agentPayAlertVariants>;

export const AgentPayAlert = forwardRef<ElementRef<typeof Alert>, AgentPayAlertProps>(
  ({ className, variant, ...props }, ref) => (
    <Alert
      className={agentPayCn("agent-pay-alert", agentPayAlertVariants({ variant }), className)}
      ref={ref}
      variant={variant === "error" ? "destructive" : "default"}
      {...props}
    />
  )
);
AgentPayAlert.displayName = "AgentPayAlert";

export const AgentPayField = forwardRef<ElementRef<typeof Label>, ComponentPropsWithoutRef<typeof Label>>(
  ({ className, ...props }, ref) => (
    <Label className={agentPayCn("agent-pay-field", className)} ref={ref} {...props} />
  )
);
AgentPayField.displayName = "AgentPayField";

export const AgentPayFieldLabel = forwardRef<HTMLSpanElement, ComponentPropsWithoutRef<"span">>(
  ({ className, ...props }, ref) => (
    <span className={agentPayCn("agent-pay-field-label text-muted-foreground", className)} ref={ref} {...props} />
  )
);
AgentPayFieldLabel.displayName = "AgentPayFieldLabel";

export const AgentPayCodeBlock = forwardRef<HTMLElement, ComponentPropsWithoutRef<"code">>(
  ({ className, ...props }, ref) => (
    <code className={agentPayCn("agent-pay-code-block tx-hash bg-muted text-foreground", className)} ref={ref} {...props} />
  )
);
AgentPayCodeBlock.displayName = "AgentPayCodeBlock";

export const AgentPayInlineCode = forwardRef<HTMLElement, ComponentPropsWithoutRef<"code">>(
  ({ className, ...props }, ref) => (
    <code className={agentPayCn("agent-pay-inline-code bg-muted text-foreground", className)} ref={ref} {...props} />
  )
);
AgentPayInlineCode.displayName = "AgentPayInlineCode";

export const AgentPayDataList = forwardRef<HTMLDListElement, ComponentPropsWithoutRef<"dl">>(
  ({ className, ...props }, ref) => (
    <dl className={agentPayCn("agent-pay-data-list", className)} ref={ref} {...props} />
  )
);
AgentPayDataList.displayName = "AgentPayDataList";

export const AgentPayDataRow = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => (
    <div className={agentPayCn("agent-pay-data-row border-border", className)} ref={ref} {...props} />
  )
);
AgentPayDataRow.displayName = "AgentPayDataRow";

export const AgentPaySeparator = forwardRef<ElementRef<typeof Separator>, ComponentPropsWithoutRef<typeof Separator>>(
  ({ className, ...props }, ref) => (
    <Separator className={agentPayCn("agent-pay-separator", className)} ref={ref} {...props} />
  )
);
AgentPaySeparator.displayName = "AgentPaySeparator";

export const AgentPaySkeleton = ({ className, ...props }: ComponentPropsWithoutRef<typeof Skeleton>) => (
  <Skeleton className={agentPayCn("agent-pay-skeleton", className)} {...props} />
);

export const AgentPayTabs = Tabs;

export const AgentPayTabsList = forwardRef<ElementRef<typeof TabsList>, ComponentPropsWithoutRef<typeof TabsList>>(
  ({ className, ...props }, ref) => (
    <TabsList className={agentPayCn("agent-pay-tabs-list", className)} ref={ref} {...props} />
  )
);
AgentPayTabsList.displayName = "AgentPayTabsList";

export const AgentPayTabsTrigger = forwardRef<ElementRef<typeof TabsTrigger>, ComponentPropsWithoutRef<typeof TabsTrigger>>(
  ({ className, ...props }, ref) => (
    <TabsTrigger className={agentPayCn("agent-pay-tabs-trigger", className)} ref={ref} {...props} />
  )
);
AgentPayTabsTrigger.displayName = "AgentPayTabsTrigger";

export const AgentPayTabsContent = forwardRef<ElementRef<typeof TabsContent>, ComponentPropsWithoutRef<typeof TabsContent>>(
  ({ className, ...props }, ref) => (
    <TabsContent className={agentPayCn("agent-pay-tabs-content", className)} ref={ref} {...props} />
  )
);
AgentPayTabsContent.displayName = "AgentPayTabsContent";

export const AgentPayTable = forwardRef<ElementRef<typeof Table>, ComponentPropsWithoutRef<typeof Table>>(
  ({ className, ...props }, ref) => (
    <Table className={agentPayCn("agent-pay-table", className)} ref={ref} {...props} />
  )
);
AgentPayTable.displayName = "AgentPayTable";

export const AgentPayTableHeader = TableHeader;
export const AgentPayTableBody = TableBody;
export const AgentPayTableRow = TableRow;
export const AgentPayTableHead = TableHead;
export const AgentPayTableCell = TableCell;

export const AgentPaySheet = Sheet;

export const AgentPaySheetContent = forwardRef<ElementRef<typeof SheetContent>, ComponentPropsWithoutRef<typeof SheetContent>>(
  ({ className, ...props }, ref) => (
    <SheetContent className={agentPayCn("agent-pay-sheet-content", className)} ref={ref} {...props} />
  )
);
AgentPaySheetContent.displayName = "AgentPaySheetContent";

export const AgentPaySheetHeader = SheetHeader;
export const AgentPaySheetTitle = SheetTitle;
export const AgentPaySheetDescription = SheetDescription;

export const AgentPayTooltipProvider = TooltipProvider;
export const AgentPayTooltip = Tooltip;
export const AgentPayTooltipTrigger = TooltipTrigger;

export const AgentPayTooltipContent = forwardRef<ElementRef<typeof TooltipContent>, ComponentPropsWithoutRef<typeof TooltipContent>>(
  ({ className, ...props }, ref) => (
    <TooltipContent className={agentPayCn("agent-pay-tooltip-content", className)} ref={ref} {...props} />
  )
);
AgentPayTooltipContent.displayName = "AgentPayTooltipContent";

export function AgentPayIconAction({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <AgentPayTooltip>
      <AgentPayTooltipTrigger asChild>
        <AgentPayButton variant="icon" aria-label={label} onClick={onClick}>
          {children}
        </AgentPayButton>
      </AgentPayTooltipTrigger>
      <AgentPayTooltipContent>{label}</AgentPayTooltipContent>
    </AgentPayTooltip>
  );
}

export const AgentPayTimeline = forwardRef<HTMLOListElement, ComponentPropsWithoutRef<"ol">>(
  ({ className, ...props }, ref) => (
    <ol className={agentPayCn("agent-pay-timeline timeline", className)} ref={ref} {...props} />
  )
);
AgentPayTimeline.displayName = "AgentPayTimeline";

const agentPayTimelineItemVariants = cva("agent-pay-timeline-item timeline-step", {
  variants: {
    state: {
      pending: "pending",
      done: "done"
    }
  },
  defaultVariants: {
    state: "pending"
  }
});

type AgentPayTimelineItemProps = ComponentPropsWithoutRef<"li"> & VariantProps<typeof agentPayTimelineItemVariants>;

export const AgentPayTimelineItem = forwardRef<HTMLLIElement, AgentPayTimelineItemProps>(
  ({ className, state, ...props }, ref) => (
    <li className={agentPayCn(agentPayTimelineItemVariants({ state }), className)} ref={ref} {...props} />
  )
);
AgentPayTimelineItem.displayName = "AgentPayTimelineItem";
