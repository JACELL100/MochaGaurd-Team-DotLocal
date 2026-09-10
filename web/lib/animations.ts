import { type Variants, type Transition } from "framer-motion";

/**
 * 60fps GPU-Accelerated Animation Configurations
 */

export const transitions = {
  spring: {
    type: "spring",
    damping: 25,
    stiffness: 120,
  } as Transition,

  smooth: {
    duration: 0.6,
    ease: [0.16, 1, 0.3, 1], // Custom snappy-yet-smooth curve
  } as Transition,

  slowEthereal: {
    duration: 1.2,
    ease: [0.25, 0.1, 0.25, 1],
  } as Transition,

  continuousSpin: {
    repeat: Infinity,
    ease: "linear",
    duration: 24,
  } as Transition,

  breathingPulse: {
    repeat: Infinity,
    repeatType: "reverse",
    duration: 3,
    ease: "easeInOut",
  } as Transition,
};

export const heroVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 24 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: 0.8,
      ease: [0.16, 1, 0.3, 1],
      staggerChildren: 0.12,
    },
  },
};

export const childFadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  },
};

export const cardHoverVariants: Variants = {
  initial: { y: 0, scale: 1 },
  hover: {
    y: -4,
    scale: 1.01,
    transition: { duration: 0.25, ease: "easeOut" },
  },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
};
