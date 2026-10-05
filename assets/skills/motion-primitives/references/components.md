# Motion Primitives — 33 个组件速查

全量 33 个 `registry:ui`，全部 MIT 免费。props 签名由 `https://motion-primitives.com/c/registry.json` 的源码程序化提取（非手写，可信）。

- 安装：`npx motion-primitives@latest add <name>`
- 取源码：`https://raw.githubusercontent.com/ibelick/motion-primitives/main/components/core/<name>.tsx`
- 共同前置：Tailwind CSS + `cn`（`@/lib/utils`）+ `motion`

---

## 文字

### text-effect

- 依赖：motion
- 文件：`text-effect.tsx`
- 导出：`TextEffect`
- `TextEffectProps`：
  - `children: string`
  - `per?: PerType`
  - `as?: keyof React.JSX.IntrinsicElements`
  - `variants?: {...}（见源码）`
  - `className?: string`
  - `preset?: PresetType`
  - `delay?: number`
  - `speedReveal?: number`
  - `speedSegment?: number`
  - `trigger?: boolean`
  - `onAnimationComplete?: () => void`
  - `onAnimationStart?: () => void`
  - `segmentWrapperClassName?: string`
  - `containerTransition?: Transition`
  - `segmentTransition?: Transition`
  - `style?: React.CSSProperties`

### text-loop

- 依赖：motion
- 文件：`text-loop.tsx`
- 导出：`TextLoop`
- `TextLoopProps`：
  - `children: React.ReactNode[]`
  - `className?: string`
  - `interval?: number`
  - `transition?: Transition`
  - `variants?: Variants`
  - `onIndexChange?: (index: number) => void`
  - `trigger?: boolean`
  - `mode?: AnimatePresenceProps['mode']`

### text-morph

- 依赖：motion
- 文件：`text-morph.tsx`
- 导出：`TextMorph`
- `TextMorphProps`：
  - `children: string`
  - `as?: React.ElementType`
  - `className?: string`
  - `style?: React.CSSProperties`
  - `variants?: Variants`
  - `transition?: Transition`

### text-roll

- 依赖：motion
- 文件：`text-roll.tsx`
- 导出：`TextRoll`
- `TextRollProps`：
  - `children: string`
  - `duration?: number`
  - `getEnterDelay?: (index: number) => number`
  - `getExitDelay?: (index: number) => number`
  - `className?: string`
  - `transition?: Transition`
  - `variants?: {...}（见源码）`
  - `onAnimationComplete?: () => void`

### text-scramble

- 依赖：motion
- 文件：`text-scramble.tsx`
- 导出：`TextScramble`

### text-shimmer

- 依赖：motion
- 文件：`text-shimmer.tsx`
- 导出：`TextShimmer`
- `TextShimmerProps`：
  - `children: string`
  - `as?: React.ElementType`
  - `className?: string`
  - `duration?: number`
  - `spread?: number`

### text-shimmer-wave

- 依赖：motion
- 文件：`text-shimmer-wave.tsx`
- 导出：`TextShimmerWave`
- `TextShimmerWaveProps`：
  - `children: string`
  - `as?: React.ElementType`
  - `className?: string`
  - `duration?: number`
  - `zDistance?: number`
  - `xDistance?: number`
  - `yDistance?: number`
  - `spread?: number`
  - `scaleDistance?: number`
  - `rotateYDistance?: number`
  - `transition?: Transition`


## 数字

### animated-number

- 依赖：motion
- 文件：`animated-number.tsx`
- 导出：`AnimatedNumber`
- `AnimatedNumberProps`：
  - `value: number`
  - `className?: string`
  - `springOptions?: SpringOptions`
  - `as?: React.ElementType`

### sliding-number

- 依赖：motion, react-use-measure
- 文件：`sliding-number.tsx`
- 导出：`SlidingNumber`


## 结构 / 入场

### in-view

- 依赖：motion
- 文件：`in-view.tsx`
- 导出：`InView`
- `InViewProps`：
  - `children: ReactNode`
  - `variants?: {...}（见源码）`
  - `transition?: Transition`
  - `viewOptions?: UseInViewOptions`
  - `as?: React.ElementType`
  - `once?: boolean`

### animated-group

- 依赖：motion
- 文件：`animated-group.tsx`
- `AnimatedGroupProps`：
  - `children: ReactNode`
  - `className?: string`
  - `variants?: {...}（见源码）`
  - `preset?: PresetType`
  - `as?: React.ElementType`
  - `asChild?: React.ElementType`

### disclosure

- 依赖：motion
- 文件：`disclosure.tsx`
- 导出：`Disclosure`、`DisclosureTrigger`、`DisclosureContent`
- `DisclosureProviderProps`：
  - `children: React.ReactNode`
  - `open: boolean`
  - `onOpenChange?: (open: boolean) => void`
  - `variants?: { expanded: Variant; collapsed: Variant }`
- `DisclosureProps`：
  - `open?: boolean`
  - `onOpenChange?: (open: boolean) => void`
  - `children: React.ReactNode`
  - `className?: string`
  - `variants?: { expanded: Variant; collapsed: Variant }`
  - `transition?: Transition`

### accordion

- 依赖：motion
- 文件：`accordion.tsx`
- `AccordionProviderProps`：
  - `children: ReactNode`
  - `variants?: { expanded: Variant; collapsed: Variant }`
  - `expandedValue?: React.Key | null`
  - `onValueChange?: (value: React.Key | null) => void`
- `AccordionProps`：
  - `children: ReactNode`
  - `className?: string`
  - `transition?: Transition`
  - `variants?: { expanded: Variant; collapsed: Variant }`
  - `expandedValue?: React.Key | null`
  - `onValueChange?: (value: React.Key | null) => void`
- `AccordionItemProps`：
  - `value: React.Key`
  - `children: ReactNode`
  - `className?: string`
- `AccordionTriggerProps`：
  - `children: ReactNode`
  - `className?: string`
- `AccordionContentProps`：
  - `children: ReactNode`
  - `className?: string`

### transition-panel

- 依赖：motion
- 文件：`transition-panel.tsx`
- 导出：`TransitionPanel`

### carousel

- 依赖：motion
- 文件：`carousel.tsx`
- `CarouselProviderProps`：
  - `children: ReactNode`
  - `initialIndex?: number`
  - `onIndexChange?: (newIndex: number) => void`
  - `disableDrag?: boolean`
- `CarouselProps`：
  - `children: ReactNode`
  - `className?: string`
  - `initialIndex?: number`
  - `index?: number`
  - `onIndexChange?: (newIndex: number) => void`
  - `disableDrag?: boolean`
- `CarouselNavigationProps`：
  - `className?: string`
  - `classNameButton?: string`
  - `alwaysShow?: boolean`
- `CarouselIndicatorProps`：
  - `className?: string`
  - `classNameButton?: string`
- `CarouselContentProps`：
  - `children: ReactNode`
  - `className?: string`
  - `transition?: Transition`
- `CarouselItemProps`：
  - `children: ReactNode`
  - `className?: string`


## 交互反馈

### magnetic

- 依赖：motion
- 文件：`magnetic.tsx`
- 导出：`Magnetic`
- `MagneticProps`：
  - `children: React.ReactNode`
  - `intensity?: number`
  - `range?: number`
  - `actionArea?: 'self' | 'parent' | 'global'`
  - `springOptions?: SpringOptions`

### tilt

- 依赖：motion
- 文件：`tilt.tsx`
- 导出：`Tilt`
- `TiltProps`：
  - `children: React.ReactNode`
  - `className?: string`
  - `style?: MotionStyle`
  - `rotationFactor?: number`
  - `isRevese?: boolean`
  - `springOptions?: SpringOptions`

### spotlight

- 依赖：motion
- 文件：`spotlight.tsx`
- 导出：`Spotlight`
- `SpotlightProps`：
  - `className?: string`
  - `size?: number`
  - `springOptions?: SpringOptions`

### glow-effect

- 依赖：motion
- 文件：`glow-effect.tsx`
- 导出：`GlowEffect`
- `GlowEffectProps`：
  - `className?: string`
  - `style?: React.CSSProperties`
  - `colors?: string[]`
  - `mode?: | 'rotate'`
  - `blur?: | number`
  - `transition?: Transition`
  - `scale?: number`
  - `duration?: number`

### border-trail

- 依赖：motion
- 文件：`border-trail.tsx`
- 导出：`BorderTrail`
- `BorderTrailProps`：
  - `className?: string`
  - `size?: number`
  - `transition?: Transition`
  - `onAnimationComplete?: () => void`
  - `style?: React.CSSProperties`

### cursor

- 依赖：motion
- 文件：`cursor.tsx`
- 导出：`Cursor`
- `CursorProps`：
  - `children: React.ReactNode`
  - `className?: string`
  - `springConfig?: SpringOptions`
  - `attachToParent?: boolean`
  - `transition?: Transition`
  - `variants?: {...}（见源码）`
  - `onPositionChange?: (x: number, y: number) => void`

### scroll-progress

- 依赖：motion
- 文件：`scroll-progress.tsx`
- 导出：`ScrollProgress`
- `ScrollProgressProps`：
  - `className?: string`
  - `springOptions?: SpringOptions`
  - `containerRef?: RefObject<HTMLDivElement>`

### spinning-text

- 依赖：motion
- 文件：`spinning-text.tsx`
- 导出：`SpinningText`
- `SpinningTextProps`：
  - `children: string`
  - `style?: CSSProperties`
  - `duration?: number`
  - `className?: string`
  - `reverse?: boolean`
  - `fontSize?: number`
  - `radius?: number`
  - `transition?: Transition`
  - `variants?: {...}（见源码）`


## 浮层

### dialog

- 依赖：motion
- 文件：`dialog.tsx`、`hooks/usePreventScroll.tsx`
- 导出：`useIsomorphicLayoutEffect`、`isScrollable`、`getScrollParent`、`usePreventScroll`、`isInput`
- `DialogProps`：
  - `children: React.ReactNode`
  - `variants?: Variants`
  - `transition?: Transition`
  - `className?: string`
  - `defaultOpen?: boolean`
  - `onOpenChange?: (open: boolean) => void`
  - `open?: boolean`
- `DialogTriggerProps`：
  - `children: React.ReactNode`
  - `className?: string`
- `DialogPortalProps`：
  - `children: React.ReactNode`
  - `container?: HTMLElement | null`
- `DialogContentProps`：
  - `children: React.ReactNode`
  - `className?: string`
  - `container?: HTMLElement`
- `DialogHeaderProps`：
  - `children: React.ReactNode`
  - `className?: string`
- `DialogTitleProps`：
  - `children: React.ReactNode`
  - `className?: string`
- `DialogDescriptionProps`：
  - `children: React.ReactNode`
  - `className?: string`
- `DialogCloseProps`：
  - `className?: string`
  - `children?: React.ReactNode`
  - `disabled?: boolean`

### morphing-dialog

- 依赖：motion
- 文件：`morphing-dialog.tsx`、`hooks/useClickOutside.tsx`
- `MorphingDialogProviderProps`：
  - `children: React.ReactNode`
  - `transition?: Transition`
- `MorphingDialogProps`：
  - `children: React.ReactNode`
  - `transition?: Transition`
- `MorphingDialogTriggerProps`：
  - `children: React.ReactNode`
  - `className?: string`
  - `style?: React.CSSProperties`
  - `triggerRef?: React.RefObject<HTMLButtonElement>`
- `MorphingDialogContentProps`：
  - `children: React.ReactNode`
  - `className?: string`
  - `style?: React.CSSProperties`
- `MorphingDialogContainerProps`：
  - `children: React.ReactNode`
  - `className?: string`
  - `style?: React.CSSProperties`
- `MorphingDialogTitleProps`：
  - `children: React.ReactNode`
  - `className?: string`
  - `style?: React.CSSProperties`
- `MorphingDialogSubtitleProps`：
  - `children: React.ReactNode`
  - `className?: string`
  - `style?: React.CSSProperties`
- `MorphingDialogDescriptionProps`：
  - `children: React.ReactNode`
  - `className?: string`
  - `disableLayoutAnimation?: boolean`
  - `variants?: {...}（见源码）`
- `MorphingDialogImageProps`：
  - `src: string`
  - `alt: string`
  - `className?: string`
  - `style?: React.CSSProperties`
- `MorphingDialogCloseProps`：
  - `children?: React.ReactNode`
  - `className?: string`
  - `variants?: {...}（见源码）`

### morphing-popover

- 依赖：motion
- 文件：`morphing-popover.tsx`、`hooks/useClickOutside.tsx`

### progressive-blur

- 依赖：motion
- 文件：`progressive-blur.tsx`
- 导出：`GRADIENT_ANGLES`、`ProgressiveBlur`


## 布局 / 容器

### animated-background

- 依赖：motion
- 文件：`animated-background.tsx`
- 导出：`AnimatedBackground`
- `AnimatedBackgroundProps`：
  - `children: | ReactElement<{ 'data-id': string }>[]`
  - `defaultValue?: string`
  - `onValueChange?: (newActiveId: string | null) => void`
  - `className?: string`
  - `transition?: Transition`
  - `enableHover?: boolean`

### infinite-slider

- 依赖：motion, react-use-measure
- 文件：`infinite-slider.tsx`
- 导出：`InfiniteSlider`
- `InfiniteSliderProps`：
  - `children: React.ReactNode`
  - `gap?: number`
  - `speed?: number`
  - `speedOnHover?: number`
  - `direction?: 'horizontal' | 'vertical'`
  - `reverse?: boolean`
  - `className?: string`

### image-comparison

- 依赖：motion
- 文件：`image-comparison.tsx`
- `ImageComparisonProps`：
  - `children: React.ReactNode`
  - `className?: string`
  - `enableHover?: boolean`
  - `springOptions?: SpringOptions`

### dock

- 依赖：motion
- 文件：`dock.tsx`
- `DockProps`：
  - `children: React.ReactNode`
  - `className?: string`
  - `distance?: number`
  - `panelHeight?: number`
  - `magnification?: number`
  - `spring?: SpringOptions`
- `DockItemProps`：
  - `className?: string`
  - `children: React.ReactNode`
  - `onClick?: () => void`
- `DockLabelProps`：
  - `className?: string`
  - `children: React.ReactNode`
- `DockIconProps`：
  - `className?: string`
  - `children: React.ReactNode`
- `DockProviderProps`：
  - `children: React.ReactNode`
  - `value: DocContextType`

### toolbar-expandable

- 依赖：motion, react-use-measure
- 文件：`toolbar-expandable.tsx`、`hooks/useClickOutside.tsx`
- 导出：`ToolbarExpandable`
- ⚠️ **demo 组件**：默认导出且硬编码示例数据与配色，当参考实现读，不要直接用

### toolbar-dynamic

- 依赖：motion
- 文件：`toolbar-dynamic.tsx`、`hooks/useClickOutside.tsx`
- 导出：`ToolbarDynamic`
- ⚠️ **demo 组件**：默认导出且硬编码示例数据与配色，当参考实现读，不要直接用

