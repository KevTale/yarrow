"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Transition } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./checkbox.module.css";

/**
 * uiarc's checkbox on a native input (Yarrow: no Radix, and the label may
 * hold a link). The fill grows from the center on a snappy spring while the
 * check draws itself; unchecking fades both a little slower.
 */
export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

const checkPath = "M4.25 9.25 L7.25 12.25 L13.75 5.75";

export function Checkbox({
  checked,
  onCheckedChange,
  children,
  disabled,
  className,
}: CheckboxProps) {
  const reduced = useReducedMotion();
  const fade: Transition = {
    duration: checked
      ? motionTokens.duration.instant
      : motionTokens.duration.fast,
    ease: [...motionTokens.ease.standard],
  };
  return (
    <label
      className={[styles.field, className].filter(Boolean).join(" ")}
      data-disabled={disabled || undefined}
    >
      <span className={styles.box}>
        <input
          type="checkbox"
          className={styles.input}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onCheckedChange(event.target.checked)}
        />
        <span
          className={styles.visual}
          data-state={checked ? "checked" : "unchecked"}
          aria-hidden="true"
        >
          <motion.span
            className={styles.fill}
            initial={false}
            animate={{ opacity: checked ? 1 : 0, scale: checked ? 1 : 0.6 }}
            transition={
              reduced
                ? { duration: 0 }
                : { scale: motionTokens.spring.snappy, opacity: fade }
            }
          />
          <svg
            className={styles.mark}
            viewBox="0 0 18 18"
            fill="none"
            focusable="false"
          >
            <motion.path
              d={checkPath}
              initial={false}
              animate={{
                pathLength: checked ? 1 : 0,
                opacity: checked ? 1 : 0,
              }}
              transition={
                reduced
                  ? { duration: 0 }
                  : { pathLength: motionTokens.spring.snappy, opacity: fade }
              }
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </span>
      <span className={styles.copy}>{children}</span>
    </label>
  );
}
