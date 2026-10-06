<template>
  <div class="page profile-governors-page h-full flex flex-col overflow-hidden bg-surface">
    <div class="max-w-3xl mx-auto h-full flex flex-col w-full">
      <!-- Header -->
      <div class="flex-none p-5 pb-3">
        <div class="flex items-center gap-4 mb-2">
          <button @click="goBack" class="text-on-surface transition-colors">
            <ArrowLeftIcon class="w-6 h-6 cursor-pointer rtl:rotate-180" />
          </button>
          <h1 class="text-xl font-semibold text-on-surface">
            {{ $t('profile_governors.title') }}
          </h1>
        </div>
      </div>

      <div class="scrollbar-hidden pb-safe-nav flex-1 min-h-0 overflow-y-scroll px-5">
        <!-- Notification toggle -->
        <div class="bg-primary-container rounded-3xl p-5 mb-6">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-base font-medium text-on-primary-container">
              {{ $t('profile_governors.notify_title') }}
            </h2>
            <ToggleSwitch v-model="notifyEnabled" @update:modelValue="toggleNotify" />
          </div>
          <p class="text-xs text-on-primary-container/80 mt-2 leading-relaxed">
            {{ $t('profile_governors.notify_brief') }}
          </p>
        </div>

        <p v-if="loadFailed" class="text-sm text-error mb-4">
          {{ $t('profile_governors.load_failed') }}
        </p>

        <!-- One section per profile -->
        <div v-for="profile in profiles" :key="profile.key" class="mb-4">
          <div class="px-4 py-2 mb-1">
            <h2 class="text-sm font-medium text-on-surface-variant">
              {{ profile.label }}
            </h2>
          </div>

          <div class="space-y-1.5">
            <div v-for="kind in kinds" :key="kind" class="md3-list">
              <RippleComponent
                @click="openPicker(kind, profile)"
                class="md3-list-item"
                :class="{ 'opacity-60 pointer-events-none': isKindUnsupported(kind) }"
                tabindex="0"
              >
                <div class="flex items-center justify-between px-5 py-4">
                  <div class="flex-1 min-w-0">
                    <h3 class="text-sm font-medium text-on-surface">
                      {{ $t(`profile_governors.${kind}`) }}
                    </h3>
                    <p class="text-xs text-on-surface-variant mt-1 break-all">
                      {{ currentLabel(kind, profile.key) }}
                    </p>
                  </div>

                  <div
                    class="w-7 h-7 rounded-full bg-surface-dim flex items-center justify-center shrink-0 ms-3"
                  >
                    <ChevronRightIcon
                      class="text-on-surface-variant shrink-0 rtl:rotate-180"
                      :size="22"
                    />
                  </div>
                </div>
              </RippleComponent>
            </div>
          </div>
        </div>

        <InformationOutlineIcon class="text-on-surface-variant my-4" :size="22" />
        <p class="text-sm text-on-surface-variant leading-relaxed mb-6">
          {{ $t('profile_governors.brief') }}
        </p>
      </div>
    </div>

    <!-- Governor picker -->
    <Modal :show="picker.show" :title="pickerTitle" @close="closePicker">
      <div class="pb-2">
        <div
          v-for="option in pickerOptions"
          :key="option.value"
          @click="selectGovernor(option.value)"
          class="px-4 py-3.5 cursor-pointer transition-colors bg-transparent"
        >
          <RadioButton
            :model-value="pickerCurrent"
            :value="option.value"
            :name="radioGroupName"
            :label="option.label"
            @update:model-value="selectGovernor"
          />
        </div>
      </div>

      <template #actions>
        <button
          @click="closePicker"
          class="px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 rounded-full transition-colors"
        >
          {{ $t('common.cancel') }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useEncoreConfigStore } from '@/stores/EncoreConfig'
import { createDebouncedSave } from '@/helpers/Debounce'

import ArrowLeftIcon from '@/components/icons/ArrowLeft.vue'
import ChevronRightIcon from '@/components/icons/ChevronRight.vue'
import InformationOutlineIcon from '@/components/icons/InformationOutline.vue'
import RippleComponent from '@/components/ui/Ripple.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import RadioButton from '@/components/ui/RadioButton.vue'
import Modal from '@/components/ui/Modal.vue'

const router = useRouter()
const { t } = useI18n()
const encoreConfigStore = useEncoreConfigStore()

const radioGroupName = 'profile-governor-group'
const kinds = ['cpu', 'gpu']

// Config keys are performance/balance/powersave, labels reuse the profile names
const profiles = computed(() => [
  { key: 'performance', label: t('profiles.performance') },
  { key: 'balance', label: t('profiles.balanced') },
  { key: 'powersave', label: t('profiles.powersave') },
])

const notifyEnabled = ref(true)
const loadFailed = ref(false)

const picker = reactive({ show: false, kind: 'cpu', profile: 'performance', profileLabel: '' })

const debouncedSave = createDebouncedSave(() => encoreConfigStore.saveConfig(), 500)

// Re-read on every access so the lists follow the store once they are loaded
const governorsOf = (kind) => encoreConfigStore.availableGovernors[kind] ?? []
const isKindUnsupported = (kind) => kind === 'gpu' && governorsOf('gpu').length === 0

function currentValue(kind, profileKey) {
  const section = kind === 'cpu' ? encoreConfigStore.cpuGovernor : encoreConfigStore.gpuGovernor
  return section?.[profileKey] ?? ''
}

function currentLabel(kind, profileKey) {
  if (isKindUnsupported(kind)) return t('profile_governors.gpu_unsupported')

  const value = currentValue(kind, profileKey)
  if (value === '') {
    return kind === 'gpu' ? t('profile_governors.gpu_keep') : t('common.unknown')
  }
  return value
}

const pickerTitle = computed(() =>
  t(`profile_governors.choose_${picker.kind}`, { profile: picker.profileLabel }),
)

const pickerCurrent = computed(() => currentValue(picker.kind, picker.profile))

const pickerOptions = computed(() => {
  const options = governorsOf(picker.kind).map((gov) => ({ value: gov, label: gov }))

  // The saved governor might not exist on this kernel (config copied from another
  // device, kernel update...), keep it visible so the user knows what is stored.
  const saved = currentValue(picker.kind, picker.profile)
  if (saved !== '' && !options.some((o) => o.value === saved)) {
    options.unshift({ value: saved, label: saved })
  }

  // Empty GPU governor = Encore leaves the GPU governor alone
  if (picker.kind === 'gpu') {
    options.unshift({ value: '', label: t('profile_governors.gpu_keep') })
  }

  return options
})

onMounted(async () => {
  try {
    if (!encoreConfigStore.isLoaded) {
      await encoreConfigStore.loadConfig()
    }
    notifyEnabled.value = encoreConfigStore.isProfileNotifyEnabled
  } catch (error) {
    console.error('Failed to load config:', error)
    loadFailed.value = true
    return
  }

  try {
    await encoreConfigStore.loadAvailableGovernors()
  } catch (error) {
    console.error('Failed to load available governors:', error)
    loadFailed.value = true
  }
})

onBeforeRouteLeave(async (to, from, next) => {
  try {
    await debouncedSave.flush()
    next()
  } catch (error) {
    console.error('Failed to save on route leave:', error)
    next(false)
  }
})

onBeforeUnmount(async () => {
  await debouncedSave.flush()
})

function openPicker(kind, profile) {
  if (isKindUnsupported(kind)) return

  picker.kind = kind
  picker.profile = profile.key
  picker.profileLabel = profile.label
  picker.show = true
}

function closePicker() {
  picker.show = false
}

function selectGovernor(value) {
  try {
    encoreConfigStore.setGovernor(picker.kind, picker.profile, value)
    debouncedSave.trigger()
  } catch (error) {
    console.error('Failed to set governor:', error)
  }
  closePicker()
}

function toggleNotify(enabled) {
  notifyEnabled.value = enabled
  try {
    encoreConfigStore.setProfileNotify(enabled)
    debouncedSave.trigger()
  } catch (error) {
    console.error('Failed to set profile notification:', error)
    notifyEnabled.value = encoreConfigStore.isProfileNotifyEnabled
  }
}

function goBack() {
  router.back()
}
</script>
