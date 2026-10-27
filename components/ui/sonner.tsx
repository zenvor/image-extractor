"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"

// shadcn/ui New York Sonner styles; this extension uses a light theme.
const Toaster = ({ toastOptions, ...props }: ToasterProps) => (
  <Sonner
    theme="light"
    className="toaster group"
    toastOptions={{
      ...toastOptions,
      classNames: {
        toast:
          "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
        description: "group-[.toast]:text-muted-foreground",
        actionButton:
          "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
        cancelButton:
          "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        ...toastOptions?.classNames,
      },
    }}
    {...props}
  />
)

export { Toaster }
export { toast } from "sonner"
