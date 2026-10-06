import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { exec } from 'kernelsu'

import * as KernelSU from '@/helpers/KernelSU'

import { useHomeStore } from '@/stores/Home'

export const useEncoreConfigStore = defineStore('encoreConfig', () => {
  const config = ref(null)

  const homeStore = useHomeStore()
  const preferences = computed(() => config.value?.preferences)

  const isLiteModeEnabled = computed(() => config.value?.preferences?.enforce_lite_mode ?? false)
  const logLevel = computed(() => config.value?.preferences?.log_level ?? 3)
  const isDeviceMitigationEnabled = computed(
    () => config.value?.preferences?.use_device_mitigation ?? false,
  )
  const isDisableTweaksEnabled = computed(() => config.value?.preferences?.disable_tweaks ?? false)
  const isProfileNotifyEnabled = computed(
    () => config.value?.preferences?.notify_profile_change ?? true,
  )
  const cpuGovernor = computed(() => config.value?.cpu_governor ?? {})
  const gpuGovernor = computed(() => config.value?.gpu_governor ?? {})
  const isLoaded = computed(() => config.value !== null)

  // Governors the kernel offers on this device, filled by loadAvailableGovernors()
  // gpu stays empty on devices without a switchable GPU governor.
  const availableGovernors = ref({ cpu: [], gpu: [] })

  const GOVERNOR_PROFILES = ['performance', 'balance', 'powersave']
  const GOVERNOR_KINDS = ['cpu', 'gpu']

  const configPath = '/data/adb/.config/encore/config.json'

  async function loadConfig() {
    try {
      const content = await KernelSU.readFile(configPath)
      config.value = JSON.parse(content)
      console.log('Encore config loaded successfully')
      return config.value
    } catch (error) {
      console.error('Failed to load encore config:', error)
      config.value = null
      throw error
    }
  }

  async function saveConfig() {
    if (!config.value) {
      throw new Error('Config not loaded')
    }

    try {
      const configString = JSON.stringify(config.value, null, 2)
      await KernelSU.writeFile(configPath, configString)
      console.log('Encore config saved successfully')
      return true
    } catch (error) {
      console.error('Failed to save encore config:', error)
      throw error
    }
  }

  function ensureConfigStructure() {
    if (!config.value) {
      throw new Error('Config not loaded')
    }

    if (!config.value.preferences) {
      config.value.preferences = {}
    }
    if (config.value.preferences.use_device_mitigation === undefined) {
      config.value.preferences.use_device_mitigation = false
    }
    if (config.value.preferences.disable_tweaks === undefined) {
      config.value.preferences.disable_tweaks = false
    }
    if (config.value.preferences.enforce_lite_mode === undefined) {
      config.value.preferences.enforce_lite_mode = false
    }
    if (config.value.preferences.log_level === undefined) {
      config.value.preferences.log_level = 5
    }
    if (config.value.preferences.notify_profile_change === undefined) {
      config.value.preferences.notify_profile_change = true
    }

    // Configs written by older versions miss some of these, the daemon fills the
    // real defaults on its next reload, we only need the objects to exist.
    if (!config.value.cpu_governor) {
      config.value.cpu_governor = {}
    }
    if (config.value.cpu_governor.performance === undefined) {
      config.value.cpu_governor.performance = 'performance'
    }
    if (!config.value.gpu_governor) {
      config.value.gpu_governor = {}
    }
    if (config.value.gpu_governor.performance === undefined) {
      config.value.gpu_governor.performance = 'performance'
    }
  }

  async function loadAvailableGovernors() {
    const { errno, stdout, stderr } = await exec(
      '/data/adb/modules/encore/system/bin/encore_utility list_governors',
    )
    if (errno !== 0) {
      throw new Error(`Failed to list governors: ${stderr}`)
    }

    const parsed = JSON.parse(stdout.trim())
    availableGovernors.value = {
      cpu: Array.isArray(parsed.cpu) ? parsed.cpu : [],
      gpu: Array.isArray(parsed.gpu) ? parsed.gpu : [],
    }
    return availableGovernors.value
  }

  /**
   * @param {'cpu'|'gpu'} kind
   * @param {'performance'|'balance'|'powersave'} profile
   * @param {string} governor - empty string is accepted for GPU only (= don't touch)
   */
  function setGovernor(kind, profile, governor) {
    if (!GOVERNOR_KINDS.includes(kind)) {
      throw new Error(`Unknown governor kind: ${kind}`)
    }
    if (!GOVERNOR_PROFILES.includes(profile)) {
      throw new Error(`Unknown profile: ${profile}`)
    }
    if (typeof governor !== 'string' || !/^[\w.:,-]*$/.test(governor)) {
      throw new Error('Invalid governor name')
    }
    if (kind === 'cpu' && governor === '') {
      throw new Error('CPU governor cannot be empty')
    }

    ensureConfigStructure()
    config.value[`${kind}_governor`][profile] = governor
  }

  function setProfileNotify(enabled) {
    ensureConfigStructure()
    config.value.preferences.notify_profile_change = enabled
  }

  function setLiteMode(enabled) {
    ensureConfigStructure()
    config.value.preferences.enforce_lite_mode = enabled
  }

  function setLogLevel(level) {
    if (level < 0 || level > 5) {
      throw new Error('Log level must be between 0 and 5')
    }

    ensureConfigStructure()
    config.value.preferences.log_level = level
  }

  function setDeviceMitigation(enabled) {
    ensureConfigStructure()
    config.value.preferences.use_device_mitigation = enabled
  }

  function setDisableTweaks(enabled) {
    ensureConfigStructure()
    config.value.preferences.disable_tweaks = enabled
  }

  function updateConfig(newConfig) {
    if (!config.value) {
      throw new Error('Config not loaded')
    }

    config.value = {
      ...config.value,
      ...newConfig,
      preferences: {
        ...config.value.preferences,
        ...(newConfig.preferences || {}),
      },
      cpu_governor: {
        ...config.value.cpu_governor,
        ...(newConfig.cpu_governor || {}),
      },
      gpu_governor: {
        ...config.value.gpu_governor,
        ...(newConfig.gpu_governor || {}),
      },
    }
  }

  return {
    config,

    preferences,
    isLiteModeEnabled,
    logLevel,
    isDeviceMitigationEnabled,
    isDisableTweaksEnabled,
    isProfileNotifyEnabled,
    cpuGovernor,
    gpuGovernor,
    availableGovernors,
    isLoaded,

    loadConfig,
    saveConfig,
    setLiteMode,
    setLogLevel,
    setDeviceMitigation,
    setDisableTweaks,
    setProfileNotify,
    setGovernor,
    loadAvailableGovernors,
    updateConfig,
  }
})
