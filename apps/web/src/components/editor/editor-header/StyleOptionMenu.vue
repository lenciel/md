<script setup lang="ts">
import type { IConfigOption } from '@md/shared/types'
import type { Component } from 'vue'
import { lockedStyleKeys } from '@md/shared/configs'
import { useThemeStore } from '@/stores/theme'

type StyleKey = `font` | `fontSize` | `color` | `lineHeight` | `blockSpacing` | `linkColor` | `blockquoteBackground` | `codeBlockTheme`

const props = defineProps<{
  title: string
  styleKey?: StyleKey
  options: IConfigOption[]
  current: string
  change: (val: any) => void
  icon?: Component
}>()

/** Per-theme settings the theme's own stylesheet decides (see theme-defaults.ts). */
const LOCKED_STYLE_KEY: Record<StyleKey, string> = {
  font: `fontFamily`,
  fontSize: `fontSize`,
  lineHeight: `lineHeight`,
  blockSpacing: `blockSpacing`,
  color: `primaryColor`,
  linkColor: `linkColor`,
  blockquoteBackground: `blockquoteBackground`,
  codeBlockTheme: `codeBlockTheme`,
}

const themeStore = useThemeStore()
const locked = computed(() => {
  const key = props.styleKey
  return key ? lockedStyleKeys(themeStore.theme).has(LOCKED_STYLE_KEY[key]) : false
})

// Keys whose desc reads as a plain hint beside the label. `font` renders its desc
// in the font itself, and `color` has no useful hint to show.
const DESC_AS_HINT_KEYS: StyleKey[] = [`fontSize`, `lineHeight`, `blockSpacing`, `linkColor`, `blockquoteBackground`]

const showDescHint = computed(() => !!props.styleKey && DESC_AS_HINT_KEYS.includes(props.styleKey))

function setStyle(styleKey: typeof props.styleKey, value: string) {
  switch (styleKey) {
    case `font`:
      return { fontFamily: value }
    case `color`:
      return { color: value }
    default:
      return {}
  }
}
</script>

<template>
  <MenubarSub v-if="!locked">
    <MenubarSubTrigger>
      <component :is="props.icon" v-if="props.icon" class="mr-2 h-4 w-4" />
      <span v-else class="mr-2 h-4 w-4" />
      <span>{{ props.title }}</span>
    </MenubarSubTrigger>
    <MenubarSubContent class="min-w-44 max-h-56 overflow-y-auto">
      <MenubarRadioGroup :model-value="current" @update:model-value="change">
        <MenubarRadioItem
          v-for="{ label, value, desc } in options"
          :key="value"
          :value="value"
          class="min-w-44"
        >
          {{ label }}
          <DropdownMenuShortcut
            v-if="styleKey === 'font' && desc"
            :style="setStyle(styleKey, value)"
          >
            {{ desc }}
          </DropdownMenuShortcut>
          <DropdownMenuShortcut
            v-else-if="showDescHint && desc"
          >
            {{ desc }}
          </DropdownMenuShortcut>
        </MenubarRadioItem>
      </MenubarRadioGroup>
    </MenubarSubContent>
  </MenubarSub>
</template>
