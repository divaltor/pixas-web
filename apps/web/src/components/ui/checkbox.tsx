import { type ComponentPropsWithoutRef, forwardRef } from 'react';

type CheckboxProps = ComponentPropsWithoutRef<'input'> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ checked, onCheckedChange, ...props }, ref) => {
    return (
      <input
        aria-checked={checked}
        checked={checked}
        className="size-4 cursor-pointer rounded border border-input shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        ref={ref}
        type="checkbox"
        {...props}
      />
    );
  }
);
Checkbox.displayName = 'Checkbox';
