package io.github.gregorgregor25.t1arc.watchinstaller

import org.junit.Assert.assertEquals
import org.junit.Test

class InstallPolicyTest {
    @Test fun freshAndOlderInstallationsCanBeInstalled() {
        assertEquals(InstallDecision.INSTALL, installDecision(null, 43, false))
        assertEquals(InstallDecision.INSTALL, installDecision(41, 43, false))
    }
    @Test fun neverDowngrade() {
        assertEquals(InstallDecision.NEWER_INSTALLED, installDecision(45, 43, false))
    }
    @Test fun reconcileAnInterruptedInstallByExactApk() {
        assertEquals(InstallDecision.ALREADY_INSTALLED, installDecision(43, 43, true))
        assertEquals(InstallDecision.INSTALL, installDecision(43, 43, false))
    }
    @Test fun onlyExplicitSuccessCounts() {
        assertEquals(InstallResponse.SUCCESS, installResponse("Success\r\n"))
        for (response in listOf("", "Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]", "Success\nFailure", "Failure [Success]")) {
            assertEquals(InstallResponse.UNCONFIRMED, installResponse(response))
        }
    }
    @Test fun signatureAndDowngradeFailuresHaveSpecificRecovery() {
        assertEquals(InstallResponse.SIGNATURE_CONFLICT, installResponse("Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]"))
        assertEquals(InstallResponse.DOWNGRADE, installResponse("Failure [INSTALL_FAILED_VERSION_DOWNGRADE]"))
    }
}
