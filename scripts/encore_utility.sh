#!/system/bin/sh
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

# shellcheck disable=SC2317,SC3006,SC3018,SC3034,SC3057,SC3037

# Config dir
MODULE_CONFIG="/data/adb/.config/encore"

change_cpu_gov() {
	chmod 644 /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor
	chmod 644 /sys/devices/system/cpu/cpufreq/policy*/scaling_governor
	chown 0:0 /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor
	chown 0:0 /sys/devices/system/cpu/cpufreq/policy*/scaling_governor
	echo "$1" | tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor >/dev/null
	echo "$1" | tee /sys/devices/system/cpu/cpufreq/policy*/scaling_governor >/dev/null
}

# Locate the GPU devfreq governor node, prints nothing if there is none.
# Keep in sync with find_gpu_gov_node() in encore_profiler.sh and service.sh
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

# Prints the governors this device offers as JSON, used by the WebUI:
# {"cpu":["walt","schedutil"],"gpu":["msm-adreno-tz","performance"]}
# "gpu" is an empty list when the device has no GPU governor to switch.
list_governors() {
	json_array() {
		first=1
		printf '['
		for gov in $1; do
			[ $first -eq 0 ] && printf ','
			printf '"%s"' "$gov"
			first=0
		done
		printf ']'
	}

	cpu_avail=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors 2>/dev/null)
	[ -z "$cpu_avail" ] && cpu_avail=$(cat /sys/devices/system/cpu/cpufreq/policy0/scaling_available_governors 2>/dev/null)

	gpu_avail=""
	gpu_node=$(find_gpu_gov_node)
	[ -n "$gpu_node" ] && gpu_avail=$(cat "${gpu_node%/*}/available_governors" 2>/dev/null)

	printf '{"cpu":%s,"gpu":%s}\n' "$(json_array "$cpu_avail")" "$(json_array "$gpu_avail")"
}

save_logs() {
	report_dir="$MODULE_CONFIG/encore_bugreport_temp"
	mkdir -p "$report_dir/pstore"

	log_file="encore_bugreport_$(date +"%Y-%m-%d_%H_%M").tar.gz"
	SOC="Unknown"

	case $(<$MODULE_CONFIG/soc_recognition) in
	1) SOC="MediaTek" ;;
	2) SOC="Snapdragon" ;;
	3) SOC="Exynos" ;;
	4) SOC="Unisoc" ;;
	5) SOC="Tensor" ;;
	6) SOC="Intel" ;;
	7) SOC="Tegra" ;;
	8) SOC="Kirin" ;;
	esac

	{
		echo "*****************************************************"
		echo "Encore Tweaks Log"
		echo "Module Version: $(awk -F'=' '/version=/ {print $2}' /data/adb/modules/encore/module.prop)"
		echo "Chipset: $SOC $(getprop ro.board.platform)"
		echo "Fingerprint: $(getprop ro.build.fingerprint)"
		echo "Android SDK: $(getprop ro.build.version.sdk)"
		echo "Kernel: $(uname -r -m)"
		echo "*****************************************************"
		echo ""
		[ -f "$MODULE_CONFIG/encore.log" ] && cat "$MODULE_CONFIG/encore.log"
	} >"$report_dir/encore.log"

	[ -f "$MODULE_CONFIG/sysmon.log" ] && cp "$MODULE_CONFIG/sysmon.log" "$report_dir/"
	cp -r /sys/fs/pstore/. "$report_dir/pstore/" 2>/dev/null

	(
		cd "$report_dir"
		[ -f "$log_file" ] && rm -f "$log_file"
		tar -czf "$log_file" .
	)

	target_dir="/sdcard/Download"
	[ ! -d "$target_dir" ] && mkdir -p "$target_dir"

	if [ -f "$report_dir/$log_file" ]; then
		cp "$report_dir/$log_file" "$target_dir/$log_file"
		echo "$target_dir/$log_file"
		rm -rf "$report_dir"
		return 0
	else
		rm -rf "$report_dir"
		return 1
	fi
}

logcat() {
	# Clear screen
	echo -ne "\e[H\e[2J\e[3J"

	# Trap CTRL+C and exit gracefully
	trap 'echo -ne "\e[H\e[2J\e[3J"; exit 0' INT

	# Detect SoC
	SOC="Unknown"
	case $(<$MODULE_CONFIG/soc_recognition) in
	1) SOC="MediaTek" ;;
	2) SOC="Snapdragon" ;;
	3) SOC="Exynos" ;;
	4) SOC="Unisoc" ;;
	5) SOC="Tensor" ;;
	6) SOC="Intel" ;;
	7) SOC="Tegra" ;;
	8) SOC="Kirin" ;;
	esac

	# Header
	echo -e "\e[1;36m┌────────────────────────────────────────────┐"
	echo -e "│          \e[1;37mEncore Tweaks Log Viewer\e[1;36m          │"
	echo -e "└────────────────────────────────────────────┘\e[0m"

	# Info block
	echo -e "
\e[1;32mModule Version:\e[0m $(awk -F'=' '/version=/ {print $2}' /data/adb/modules/encore/module.prop)
\e[1;32mChipset:\e[0m        $SOC $(getprop ro.board.platform)
\e[1;32mFingerprint:\e[0m    $(getprop ro.build.fingerprint)
\e[1;32mAndroid SDK:\e[0m    $(getprop ro.build.version.sdk)
\e[1;32mKernel:\e[0m         $(uname -r -m)

\e[1;33m[Log Stream Started — press CTRL+C to exit]\e[0m
"

	# Tail log
	tail -f $MODULE_CONFIG/encore.log | while read -r line; do
		timestamp="${line:0:23}"
		level_char=$(echo "$line" | awk '{print $3}')
		msg="${line:24}"

		# Set color based on level
		case "$level_char" in
		W) level_color="\e[1;33m" ;; # Yellow
		E) level_color="\e[1;31m" ;; # Red
		C) level_color="\e[1;31m" ;; # Red
		*) level_color="\e[0m" ;;    # Default
		esac

		echo -e "\e[1;32m$timestamp\e[0m ${level_color}${msg}\e[0m"
	done
}

# shellcheck disable=SC2068
$@
