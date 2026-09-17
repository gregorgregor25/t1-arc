package io.github.gregorgregor25.t1arc.watchinstaller

internal enum class InstallDecision { INSTALL, ALREADY_INSTALLED, NEWER_INSTALLED }
internal fun installDecision(installed: Long?, bundled: Long, identicalApk: Boolean): InstallDecision = when {
    installed != null && installed > bundled -> InstallDecision.NEWER_INSTALLED
    installed == bundled && identicalApk -> InstallDecision.ALREADY_INSTALLED
    else -> InstallDecision.INSTALL
}

internal enum class InstallResponse { SUCCESS, SIGNATURE_CONFLICT, DOWNGRADE, UNCONFIRMED }
internal fun installResponse(output: String): InstallResponse = when {
    output.contains("INSTALL_FAILED_UPDATE_INCOMPATIBLE") || output.contains("INCONSISTENT_CERTIFICATES") -> InstallResponse.SIGNATURE_CONFLICT
    output.contains("INSTALL_FAILED_VERSION_DOWNGRADE") -> InstallResponse.DOWNGRADE
    output.trim() == "Success" -> InstallResponse.SUCCESS
    else -> InstallResponse.UNCONFIRMED
}
