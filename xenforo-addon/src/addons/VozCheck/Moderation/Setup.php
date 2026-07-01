<?php

namespace VozCheck\Moderation;

use XF\AddOn\AbstractSetup;
use XF\AddOn\StepRunnerInstallTrait;
use XF\AddOn\StepRunnerUninstallTrait;
use XF\AddOn\StepRunnerUpgradeTrait;

/**
 * Install / upgrade / uninstall lifecycle for the VozCheck AI Moderation add-on.
 *
 * This add-on stores no custom database tables. All persistent configuration is
 * delivered through the declarative XML data files in `_data/` (options,
 * option groups, code event listeners, phrases) which XenForo imports
 * automatically on install/upgrade. Therefore the install/upgrade/uninstall
 * steps below are intentionally empty.
 *
 * The runner traits give us the standard `installStep1()`, `upgrade1000010Step1()`
 * dispatch convention should we ever need schema work in a future version.
 */
class Setup extends AbstractSetup
{
    use StepRunnerInstallTrait;
    use StepRunnerUpgradeTrait;
    use StepRunnerUninstallTrait;

    /**
     * Nothing to do on install: options and listeners are imported from `_data/`.
     *
     * We keep an empty step method so the StepRunnerInstallTrait has at least one
     * step to execute and the installer reports success cleanly.
     */
    public function installStep1(): void
    {
        // Intentionally empty. Options live in _data/options.xml /
        // _data/option_groups.xml and are imported by XenForo automatically.
    }

    /**
     * Nothing to do on uninstall: XenForo removes the imported options,
     * option groups, phrases and code event listeners owned by this add-on
     * automatically when the add-on is uninstalled.
     *
     * The transient registry cache key we use for the API token
     * (see \VozCheck\Moderation\Service\Client::REGISTRY_KEY) is short-lived
     * and self-expiring, so there is nothing to clean up here. If you want to
     * be thorough on a live instance you may delete it explicitly:
     *
     *   \XF::registry()->delete(\VozCheck\Moderation\Service\Client::REGISTRY_KEY);
     */
    public function uninstallStep1(): void
    {
        // Intentionally empty.
    }
}
