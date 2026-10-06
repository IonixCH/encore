import { defineStore } from 'pinia'
import { ref } from 'vue'
import { exec, toast } from 'kernelsu'
import * as KernelSU from '@/helpers/KernelSU'
import { getTranslation } from '@/helpers/Locales'
import { useEncoreConfigStore } from '@/stores/EncoreConfig'

const configPath = '/data/adb/.config/encore'
const modPath = '/data/adb/modules/encore'

export const useHomeStore = defineStore('home', () => {
  const daemonPidRaw = ref('')
  const moduleVersion = ref('')
  const currentProfileRaw = ref('')
  const kernelVersion = ref('')
  const chipsetName = ref('')
  const androidSDK = ref('')
  const daemonStatusRaw = ref('loading') // 'loading', 'running', 'stopped', 'error'
  const daemonError = ref('')
  const isInitialized = ref(false)

  let profileInterval = null
  let daemonInterval = null

  // Actions
  async function initializeData() {
    if (isInitialized.value) return

    await Promise.all([
      getServiceState(),
      getAndroidSDK(),
      getModuleVersion(),
      getCurrentProfile(),
      getKernelVersion(),
      getChipset(),
    ])

    startProfileMonitoring()
    startDaemonMonitoring()
    isInitialized.value = true
  }

  function startProfileMonitoring() {
    stopProfileMonitoring()

    profileInterval = setInterval(() => {
      getCurrentProfile()
    }, 1000)
  }

  function stopProfileMonitoring() {
    if (profileInterval) {
      clearInterval(profileInterval)
      profileInterval = null
    }
  }

  function startDaemonMonitoring() {
    stopDaemonMonitoring()

    daemonInterval = setInterval(() => {
      getServiceState()
    }, 1000)
  }

  function stopDaemonMonitoring() {
    if (daemonInterval) {
      clearInterval(daemonInterval)
      daemonInterval = null
    }
  }

  async function getServiceState() {
    try {
      if (!KernelSU.isKSUWebUI()) {
        throw new Error('Not running on KSU WebUI')
      }

      const { errno, stdout } = await exec('/system/bin/toybox pidof encored')
      const pid = stdout.trim()

      if (errno === 0 && pid) {
        daemonPidRaw.value = pid
        daemonStatusRaw.value = 'running'
        daemonError.value = ''
        return
      }

      setDaemonStopped()
      return
    } catch (error) {
      setDaemonError(error.message)
    }
  }

  function setDaemonStopped() {
    daemonStatusRaw.value = 'stopped'
    daemonPidRaw.value = ''
    daemonError.value = ''
  }

  function setDaemonError(message) {
    daemonStatusRaw.value = 'error'
    daemonError.value = message
  }

  async function getAndroidSDK() {
    try {
      if (!KernelSU.isKSUWebUI()) {
        throw new Error('Not running on KSU WebUI')
      }

      const { stdout } = await exec('getprop ro.build.version.sdk')
      androidSDK.value = stdout.trim()
    } catch (error) {
      androidSDK.value = 'unknown'
    }
  }

  async function getModuleVersion() {
    try {
      const propPath = `${modPath}/module.prop`
      const content = await KernelSU.readFile(propPath)
      const match = content.match(/^version=(.*)$/m)
      moduleVersion.value = match ? match[1].trim() : 'unknown'
    } catch (error) {
      moduleVersion.value = 'unknown'
    }
  }

  async function getCurrentProfile() {
    try {
      const output = await KernelSU.readFile(`${configPath}/current_profile`)
      const previous = currentProfileRaw.value
      currentProfileRaw.value = getProfileKey(output.trim())
      notifyProfileChange(previous, currentProfileRaw.value)
    } catch (error) {
      currentProfileRaw.value = 'unknown'
    }
  }

  // Toast while the WebUI is open. The daemon posts the system notification on its own,
  // this is just the in-app counterpart and follows the same on/off setting.
  async function notifyProfileChange(previous, current) {
    // First read, daemon (re)starting, or not a real profile: nothing to announce
    if (!previous || previous === 'unknown' || previous === 'initializing') return
    if (previous === current) return
    if (!['performance', 'balanced', 'powersave'].includes(current)) return

    try {
      const encoreConfigStore = useEncoreConfigStore()
      if (!encoreConfigStore.isLoaded) {
        await encoreConfigStore.loadConfig()
      }
      if (!encoreConfigStore.isProfileNotifyEnabled) return

      const profileName = getTranslation(`profiles.${current}`)
      toast(getTranslation('toast.profile_changed', { profile: profileName }))
    } catch (error) {
      console.warn('Unable to show profile change toast:', error)
    }
  }

  function getProfileKey(profileCode) {
    const profileMap = {
      0: 'initializing',
      1: 'performance',
      2: 'balanced',
      3: 'powersave',
    }
    return profileMap[profileCode] || 'unknown'
  }

  async function getKernelVersion() {
    try {
      if (!KernelSU.isKSUWebUI()) {
        throw new Error('Not running on KSU WebUI')
      }

      const { stdout } = await exec('uname -r -m')
      kernelVersion.value = stdout.trim()
    } catch (error) {
      kernelVersion.value = 'unknown'
    }
  }

  async function getChipset() {
    try {
      if (!KernelSU.isKSUWebUI()) {
        throw new Error('Not running on KSU WebUI')
      }

      const { stdout } = await exec('getprop ro.board.platform')
      const chipset = stdout.trim()
      const brand = await getChipsetBrand()

      chipsetName.value = `${brand} ${chipset}`
    } catch (error) {
      chipsetName.value = 'unknown'
    }
  }

  async function getChipsetBrand() {
    try {
      const soc = await KernelSU.readFile(`${configPath}/soc_recognition`)
      const brands = {
        1: 'MediaTek',
        2: 'Snapdragon',
        3: 'Exynos',
        4: 'Unisoc',
        5: 'Tensor',
        6: 'Intel',
        7: 'Tegra',
        8: 'Kirin',
      }
      return brands[soc] || ''
    } catch (error) {
      return ''
    }
  }

  return {
    // Raw state
    daemonPidRaw,
    moduleVersion,
    currentProfileRaw,
    kernelVersion,
    chipsetName,
    androidSDK,
    daemonStatusRaw,
    daemonError,
    isInitialized,

    // Actions
    initializeData,
    stopProfileMonitoring,
    stopDaemonMonitoring,
    getServiceState,
    getAndroidSDK,
    getModuleVersion,
    getCurrentProfile,
    getKernelVersion,
    getChipset,
  }
})
