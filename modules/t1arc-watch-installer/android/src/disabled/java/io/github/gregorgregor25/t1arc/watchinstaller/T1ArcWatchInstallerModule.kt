package io.github.gregorgregor25.t1arc.watchinstaller

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T1ArcWatchInstallerModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("T1ArcWatchInstaller")
        Constants("available" to false)
    }
}
