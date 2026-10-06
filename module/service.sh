#
# Copyright (C) 2024-2026 Rem01Gaming
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

MODDIR=$(dirname "$0")
MODULE_CONFIG="/data/adb/.config/encore"
CLEANUP_SCRIPT="/data/adb/service.d/.encore_cleanup.sh"
CPUFREQ="/sys/devices/system/cpu/cpu0/cpufreq"

# Restore original module.prop
[ -f "$MODDIR/module.prop.orig" ] && {
  cp "$MODDIR/module.prop.orig" "$MODDIR/module.prop"
}

# Clear old logs
rm -f "$MODULE_CONFIG/encore.log" "$MODULE_CONFIG/sysmon.log"

# Parse Governor to use
chmod 644 "$CPUFREQ/scaling_governor"
default_gov=$(cat "$CPUFREQ/scaling_governor")
echo "$default_gov" >$MODULE_CONFIG/default_cpu_gov

# Parse GPU Governor to use (not every device exposes one, MediaTek for example)
find_gpu_gov_node() {
	[ -f /sys/class/kgsl/kgsl-3d0/devfreq/governor ] && {
		echo /sys/class/kgsl/kgsl-3d0/devfreq/governor
		return 0
	}

	for dev in /sys/class/devfreq/* /sys/devices/platform/*.mali/devfreq/*; do
		[ -f "$dev/governor" ] || continue
		case "${dev##*/}" in
		*bw* | *bus* | *mem* | *ddr* | *llcc* | *cpu* | *dvfsrc*) continue ;;
		*mali* | *.gpu | *gpu*)
			echo "$dev/governor"
			return 0
			;;
		esac
	done

	return 1
}

GPU_GOV_NODE=$(find_gpu_gov_node)
default_gpu_gov=""
if [ -n "$GPU_GOV_NODE" ]; then
	chmod 644 "$GPU_GOV_NODE"
	default_gpu_gov=$(cat "$GPU_GOV_NODE")
	echo "$default_gpu_gov" >$MODULE_CONFIG/default_gpu_gov
else
	rm -f "$MODULE_CONFIG/default_gpu_gov"
fi

# Create cleanup script
[ ! -f "$CLEANUP_SCRIPT" ] && {
  mkdir -p "$(dirname $CLEANUP_SCRIPT)"
  cp "$MODDIR/cleanup.sh" "$CLEANUP_SCRIPT"
  chmod +x "$CLEANUP_SCRIPT"
}

# Wait until boot completed
while [ -z "$(getprop sys.boot_completed)" ]; do
	sleep 40
done

# Handle case when 'default_gov' is performance
default_gov_preferred_array="
scx
schedhorizon
walt
sched_pixel
sugov_ext
uag
schedplus
energy_step
schedutil
interactive
conservative
powersave
"

if [ "$default_gov" == "performance" ]; then
	for gov in $default_gov_preferred_array; do
		grep -q "$gov" "$CPUFREQ/scaling_available_governors" && {
			echo "$gov" >$MODULE_CONFIG/default_cpu_gov
			default_gov="$gov"
			break
		}
	done
fi

# Revert to normal CPU governor
echo "$default_gov" | tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor

# Handle case when default GPU governor is performance, same idea as the CPU
if [ -n "$GPU_GOV_NODE" ]; then
	if [ "$default_gpu_gov" == "performance" ]; then
		gpu_avail="${GPU_GOV_NODE%/*}/available_governors"
		for gov in msm-adreno-tz simple_ondemand mali_ondemand ondemand; do
			grep -qw "$gov" "$gpu_avail" 2>/dev/null && {
				echo "$gov" >$MODULE_CONFIG/default_gpu_gov
				default_gpu_gov="$gov"
				break
			}
		done
	fi

	# Revert to normal GPU governor
	echo "$default_gpu_gov" >"$GPU_GOV_NODE"
fi

# Mitigate buggy thermal throttling on post-startup
# in old MediaTek devices.
ENABLE_PPM="/proc/ppm/enabled"
if [ -f "$ENABLE_PPM" ]; then
	echo 0 >"$ENABLE_PPM"
	sleep 1
	echo 1 >"$ENABLE_PPM"
fi

# Start Encore Daemon
encored daemon
