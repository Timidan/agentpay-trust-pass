import * as React from "react";

import { cn } from "@/lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => (
    <div
      className={cn("bg-card text-card-foreground flex flex-col rounded-xl border shadow-sm", className)}
      data-slot="card"
      ref={ref}
      {...props}
    />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => (
    <div
      className={cn("grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 pt-6", className)}
      data-slot="card-header"
      ref={ref}
      {...props}
    />
  )
);
CardHeader.displayName = "CardHeader";

const CardContent = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => (
    <div className={cn("px-6", className)} data-slot="card-content" ref={ref} {...props} />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => (
    <div className={cn("flex items-center px-6 pb-6", className)} data-slot="card-footer" ref={ref} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

export { Card, CardContent, CardFooter, CardHeader };
