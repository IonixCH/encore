/*
 * Copyright (C) 2024-2026 Rem01Gaming
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#include <algorithm>
#include <atomic>
#include <cstdlib>
#include <fstream>
#include <mutex>
#include <string>
#include <thread>

#include "Encore.hpp"
#include "EncoreLog.hpp"
#include "Profiler.hpp"
#include "Write2File.hpp"

#include "DeviceMitigationStore.hpp"
#include "EncoreConfigStore.hpp"

#include <EncoreUtility.hpp>

void set_profiler_env_vars() {
    // Get preferences from config store
    auto prefs = config_store.get_preferences();

    // Clear all existing _ENCORE_* environment variables
    extern char **environ;
    for (char **env = environ; *env; ++env) {
        std::string env_str(*env);
        if (env_str.find("ENCORE_") == 0) {
            // Extract the variable name (up to '=')
            size_t eq_pos = env_str.find('=');
            if (eq_pos != std::string::npos) {
                std::string var_name = env_str.substr(0, eq_pos);
                unsetenv(var_name.c_str());
            }
        }
    }

    // Use cached mitigation items instead of re-evaluating rules
    auto mitigation_items = device_mitigation_store.get_cached_mitigation_items(prefs.use_device_mitigation);

    // Set environment variable for mitigation items
    for (const auto &item : mitigation_items) {
        std::string env_var = "ENCORE_" + item;
        std::transform(env_var.begin(), env_var.end(), env_var.begin(), [](unsigned char c) {
            if (!std::isalnum(c) && c != '_') return '_';
            return static_cast<char>(std::toupper(c));
        });

        setenv(env_var.c_str(), "1", 1);
        LOGD_TAG("Profiler", "Set mitigation env var: {}", env_var);
    }

    // Set CPU Governor variables
    EncoreConfigStore::CPUGovernor cpu_governor_preference = config_store.get_cpu_governor();
    setenv("ENCORE_PERFORMANCE_CPUGOV", cpu_governor_preference.performance.c_str(), 1);
    setenv("ENCORE_BALANCED_CPUGOV", cpu_governor_preference.balance.c_str(), 1);
    setenv("ENCORE_POWERSAVE_CPUGOV", cpu_governor_preference.powersave.c_str(), 1);

    // Set GPU Governor variables, empty value means "leave GPU governor alone"
    EncoreConfigStore::GPUGovernor gpu_governor_preference = config_store.get_gpu_governor();
    setenv("ENCORE_PERFORMANCE_GPUGOV", gpu_governor_preference.performance.c_str(), 1);
    setenv("ENCORE_BALANCED_GPUGOV", gpu_governor_preference.balance.c_str(), 1);
    setenv("ENCORE_POWERSAVE_GPUGOV", gpu_governor_preference.powersave.c_str(), 1);
}

// ---------------------------------------------------------------------------
// Profile change announcement (notification + toast)
// ---------------------------------------------------------------------------

// encore_profiler records which governors it really ended up using, since
// that can differ from the config (lite mode, device mitigation, governor not
// available on this kernel...). Format: one "cpu=<gov>" and "gpu=<gov>" line.
static void read_applied_governors(std::string &cpu_gov, std::string &gpu_gov) {
    cpu_gov.clear();
    gpu_gov.clear();

    std::ifstream file(APPLIED_GOV_FILE);
    if (!file.is_open()) return;

    std::string line;
    while (std::getline(file, line)) {
        if (line.rfind("cpu=", 0) == 0) {
            cpu_gov = line.substr(4);
        } else if (line.rfind("gpu=", 0) == 0) {
            gpu_gov = line.substr(4);
        }
    }
}

static void announce_profile(EncoreProfileMode mode, const std::string &detail = "") {
    if (!config_store.get_preferences().notify_profile_change) return;

    const char *name = "Balanced";
    switch (mode) {
        case PERFORMANCE_PROFILE: name = "Performance"; break;
        case POWERSAVE_PROFILE: name = "Powersave"; break;
        default: break;
    }

    std::string cpu_gov, gpu_gov;
    read_applied_governors(cpu_gov, gpu_gov);

    std::string msg = std::string(name) + " profile active";
    if (!detail.empty()) msg += " (" + detail + ")";
    msg += " | CPU: " + (cpu_gov.empty() ? std::string("-") : cpu_gov);
    if (!gpu_gov.empty()) msg += " | GPU: " + gpu_gov;

    // Don't make the profile switch wait for `cmd` to finish, and when profiles
    // flip quickly (screen off/on, game start/stop) only the newest one is shown.
    static std::atomic<uint64_t> latest_ticket{0};
    static std::mutex announce_mutex;
    const uint64_t ticket = ++latest_ticket;

    std::thread([msg, ticket]() {
        std::lock_guard<std::mutex> lock(announce_mutex);
        if (ticket != latest_ticket.load()) return;

        notify(msg.c_str());
        toast(msg.c_str());
    }).detach();
}

void run_perfcommon(void) {
    write2file(GAME_INFO, "NULL 0 0\n");
    write2file(PROFILE_MODE, static_cast<int>(PERFCOMMON), "\n");

    if (config_store.get_preferences().disable_tweaks) {
        LOGI_TAG("Profiler", "Tweaks are disabled in config, skipping perfcommon");
        return;
    }

    set_profiler_env_vars();

    if (system("encore_profiler perfcommon")) {
        LOGE("Unable to execute profiler changes to perfcommon");
    }
}

void apply_performance_profile(bool lite_mode, std::string game_pkg, pid_t game_pid, uid_t game_uid) {
    write2file(GAME_INFO, game_pkg, " ", game_pid, " ", game_uid, "\n");
    write2file(PROFILE_MODE, static_cast<int>(PERFORMANCE_PROFILE), "\n");

    if (config_store.get_preferences().disable_tweaks) {
        LOGI_TAG("Profiler", "Tweaks are disabled in config, skipping performance profile");
        return;
    }

    set_profiler_env_vars();

    if (lite_mode) {
        LOGD("Lite mode is enabled");
        if (system("encore_profiler performance_lite") != 0) {
            LOGE("Unable to execute profiler changes to performance_lite");
            return;
        }
        announce_profile(PERFORMANCE_PROFILE, "Lite, " + game_pkg);
        return;
    }

    if (system("encore_profiler performance") != 0) {
        LOGE("Unable to execute profiler changes to performance");
        return;
    }
    announce_profile(PERFORMANCE_PROFILE, game_pkg);
}

void apply_balance_profile() {
    write2file(GAME_INFO, "NULL 0 0\n");
    write2file(PROFILE_MODE, static_cast<int>(BALANCE_PROFILE), "\n");

    if (config_store.get_preferences().disable_tweaks) {
        LOGI_TAG("Profiler", "Tweaks are disabled in config, skipping balance profile");
        return;
    }

    set_profiler_env_vars();

    if (system("encore_profiler balance") != 0) {
        LOGE("Unable to execute profiler changes to balance");
        return;
    }
    announce_profile(BALANCE_PROFILE);
}

void apply_powersave_profile() {
    write2file(GAME_INFO, "NULL 0 0\n");
    write2file(PROFILE_MODE, static_cast<int>(POWERSAVE_PROFILE), "\n");

    if (config_store.get_preferences().disable_tweaks) {
        LOGI_TAG("Profiler", "Tweaks are disabled in config, skipping powersave profile");
        return;
    }

    set_profiler_env_vars();

    if (system("encore_profiler powersave") != 0) {
        LOGE("Unable to execute profiler changes to powersave");
        return;
    }
    announce_profile(POWERSAVE_PROFILE);
}
