<script setup lang="ts">
import { Field } from 'vee-validate'

withDefaults(defineProps<{
  name: string
  label: string
  placeholder?: string
  type?: `text` | `password` | `number`
  required?: boolean
  /** Optional line under the input, e.g. why an optional field may still be needed. */
  hint?: string
  inputClass?: string
}>(), {
  type: `text`,
})
</script>

<template>
  <Field v-slot="{ field, errorMessage }" :name="name">
    <FormItem :label="label" :required="required" :error="errorMessage">
      <Input
        v-bind="field"
        v-model="field.value"
        :class="inputClass"
        :type="type"
        :placeholder="placeholder"
        :aria-invalid="Boolean(errorMessage)"
      />
      <template v-if="hint" #hint>
        <p class="text-[12px] text-muted-foreground leading-snug">
          {{ hint }}
        </p>
      </template>
    </FormItem>
  </Field>
</template>
