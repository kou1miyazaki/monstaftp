<?php
    require_once(dirname(__FILE__) . '/../constants.php');
    includeMonstaConfig();
    require_once(dirname(__FILE__) . '/../file_sources/configuration/ConfigurationFactory.php');
    require_once(dirname(__FILE__) . '/../file_sources/connection/ConnectionFactory.php');
    require_once(dirname(__FILE__) . '/../file_sources/connection/RecursiveFileFinder.php');
    require_once(dirname(__FILE__) . '/../file_sources/connection/ZipBuilder.php');
    require_once(dirname(__FILE__) . '/../file_sources/transfers/TransferOperationFactory.php');
    require_once(dirname(__FILE__) . '/../stored_authentication/AuthenticationStorage.php');
    require_once(dirname(__FILE__) . '/../licensing/KeyPairSuite.php');
    require_once(dirname(__FILE__) . '/../licensing/LicenseReader.php');
    require_once(dirname(__FILE__) . '/../licensing/LicenseWriter.php');
    require_once(dirname(__FILE__) . '/../licensing/AffiliateChecker.php');
    require_once(dirname(__FILE__) . '/../system/SystemVars.php');
    require_once(dirname(__FILE__) . '/../system/ApplicationSettings.php');
    require_once(dirname(__FILE__) . '/../system/UserBanManager.php');
    require_once(dirname(__FILE__) . '/../file_fetch/HTTPFetchRequest.php');
    require_once(dirname(__FILE__) . '/../file_fetch/HTTPFetcher.php');
    require_once(dirname(__FILE__) . '/../file_sources/MultiStageUploadHelper.php');
    require_once(dirname(__FILE__) . '/../file_sources/connection/ArchiveExtractor.php');

    class RequestDispatcher {
        /**
         * @var ConnectionBase
         */
        private $connection;

        /**
         * @var string
         */
        private $connectionType;

        /**
         * @var array
         */
        private $rawConfiguration;

        public function __construct($connectionType, $rawConfiguration, $configurationFactory = null,
                                    $connectionFactory = null, $skipConfiguration = false) {
            $this->connectionType = $connectionType;
            /* allow factory objects to be passed in for testing with mocks */
            if ($skipConfiguration) {
                $this->connection = null;
            } else {
                $this->rawConfiguration = $rawConfiguration;
                $configurationFactory = is_null($configurationFactory) ? new ConfigurationFactory() : $configurationFactory;
                $connectionFactory = is_null($connectionFactory) ? new ConnectionFactory() : $connectionFactory;
                $configuration = $configurationFactory->getConfiguration($connectionType, $rawConfiguration);
                $this->connection = $connectionFactory->getConnection($connectionType, $configuration);
            }
        }

        public function dispatchRequest($actionName, $context = null) {
            if (in_array($actionName, array(
                'listDirectory',
                'downloadFile',
                'uploadFile',
                'deleteFile',
                'makeDirectory',
                'deleteDirectory',
                'rename',
                'changePermissions',
                'copy',
                'testConnectAndAuthenticate',
                'checkSavedAuthExists',
                'writeSavedAuth',
                'readSavedAuth',
                'readLicense',
                'getSystemVars',
                'fetchRemoteFile',
                'uploadFileToNewDirectory',
                'downloadMultipleFiles',
                'setApplicationSettings',
                'deleteMultiple',
                'extractArchive',
                'updateLicense',
                'reserveUploadContext',
                'transferUploadToRemote',
                'getRemoteFileSize',
                'getDefaultPath',
                'downloadForExtract',
                'cleanUpExtract',
                'resetPassword',
                'forgotPassword'
            ))) {
                if (!is_null($context))
                    return $this->$actionName($context);
                else
                    return $this->$actionName();
            }

            throw new InvalidArgumentException("Unknown action $actionName");
        }

        private function connectAndAuthenticate() {
            $sessionNeedsStarting = false;
            
            if (function_exists("session_status")) {
                if (session_status() == PHP_SESSION_NONE) {
                    $sessionNeedsStarting = true;
                }
            } else {
                $sessionNeedsStarting = session_id() == "";
            }

            if ($sessionNeedsStarting) {
                session_start();
            }

            $configuration = $this->connection->getConfiguration();

            $maxFailures = defined("MFTP_MAX_LOGIN_FAILURES") ? MFTP_MAX_LOGIN_FAILURES : 0;
            $loginFailureResetTimeSeconds = defined("MFTP_LOGIN_FAILURES_RESET_TIME_MINUTES")
                ? MFTP_LOGIN_FAILURES_RESET_TIME_MINUTES * 60 : 0;

            if (!isset($_SESSION["MFTP_LOGIN_FAILURES"]))
                $_SESSION["MFTP_LOGIN_FAILURES"] = array();

            $banManager = new UserBanManager($maxFailures, $loginFailureResetTimeSeconds,
                $_SESSION["MFTP_LOGIN_FAILURES"]);

            if ($banManager->hostAndUserBanned($configuration->getHost(), $configuration->getRemoteUsername())) {
                throw new FileSourceAuthenticationException("Login and user has exceed maximum failures.",
                    LocalizableExceptionDefinition::$LOGIN_FAILURE_EXCEEDED_ERROR, array(
                        "banTimeMinutes" => MFTP_LOGIN_FAILURES_RESET_TIME_MINUTES
                    ));
            }

            $this->connection->connect();

            try {
                $this->connection->authenticate();
            } catch (Exception $e) {
                $banManager->recordHostAndUserLoginFailure($configuration->getHost(),
                    $configuration->getRemoteUsername());

                $_SESSION["MFTP_LOGIN_FAILURES"] = $banManager->getStore();

                throw $e;
            }

            $banManager->resetHostUserLoginFailure($configuration->getHost(), $configuration->getRemoteUsername());

            $_SESSION["MFTP_LOGIN_FAILURES"] = $banManager->getStore();
        }

        public function disconnect() {
            if ($this->connection != null && $this->connection->isConnected())
                $this->connection->disconnect();
        }

        public function listDirectory($context) {
            $this->connectAndAuthenticate();
            $directoryList = $this->connection->listDirectory($context['path'], $context['showHidden']);
            $this->disconnect();
            return $directoryList;
        }

        public function downloadFile($context) {
            $this->connectAndAuthenticate();
            $transferOp = TransferOperationFactory::getTransferOperation($this->connectionType, $context);
            $this->connection->downloadFile($transferOp);
            $this->disconnect();
        }

        public function downloadMultipleFiles($context) {
            $this->connectAndAuthenticate();
            $fileFinder = new RecursiveFileFinder($this->connection, $context['baseDirectory']);
            $foundFiles = $fileFinder->findFilesInPaths($context['items']);

            $zipBuilder = new ZipBuilder($this->connection, $context['baseDirectory']);
            $zipPath = $zipBuilder->buildZip($foundFiles);

            $this->disconnect();
            return $zipPath;
        }

        public function uploadFile($context) {
            $this->connectAndAuthenticate();
            $transferOp = TransferOperationFactory::getTransferOperation($this->connectionType, $context);
            $this->connection->uploadFile($transferOp);
            $this->disconnect();
        }

        public function uploadFileToNewDirectory($context) {
            // This will first create the target directory if it doesn't exist and then upload to that directory
            $this->connectAndAuthenticate();
            $transferOp = TransferOperationFactory::getTransferOperation($this->connectionType, $context);
            $this->connection->uploadFileToNewDirectory($transferOp);
            $this->disconnect();
        }

        public function deleteFile($context) {
            $this->connectAndAuthenticate();
            $this->connection->deleteFile($context['remotePath']);
            $this->disconnect();
        }

        public function makeDirectory($context) {
            $this->connectAndAuthenticate();
            $this->connection->makeDirectory($context['remotePath']);
            $this->disconnect();
        }

        public function deleteDirectory($context) {
            $this->connectAndAuthenticate();
            $this->connection->deleteDirectory($context['remotePath']);
            $this->disconnect();
        }

        public function rename($context) {
            $this->connectAndAuthenticate();
            $this->connection->rename($context['source'], $context['destination']);
            $this->disconnect();
        }

        public function changePermissions($context) {
            $this->connectAndAuthenticate();
            $this->connection->changePermissions($context['mode'], $context['remotePath']);
            $this->disconnect();
        }

        public function copy($context) {
            $this->connectAndAuthenticate();
            $this->connection->copy($context['source'], $context['destination']);
            $this->disconnect();
        }

        public function testConnectAndAuthenticate($context) {
            $this->connectAndAuthenticate();
            $serverCapabilities = array();

            if (isset($context['getServerCapabilities']) && $context['getServerCapabilities']) {
                $serverCapabilities["changePermissions"] = $this->connection->supportsPermissionChange();
            }

            return array("serverCapabilities" => $serverCapabilities);
        }

        public function checkSavedAuthExists() {
            if ($this->readLicense() == null)
                return false;

            return AuthenticationStorage::configurationExists(AUTHENTICATION_FILE_PATH);
        }

        public function writeSavedAuth($context) {
            if ($this->readLicense() == null)
                return;

            AuthenticationStorage::saveConfiguration(AUTHENTICATION_FILE_PATH, $context['password'],
                $context['authData']);
        }

        public function readSavedAuth($context) {
            if ($this->readLicense() == null)
                return array();

            return AuthenticationStorage::loadConfiguration(AUTHENTICATION_FILE_PATH, $context['password']);
        }

        public function readLicense() {
            $keyPairSuite = new KeyPairSuite(PUBKEY_PATH);
            $licenseReader = new LicenseReader($keyPairSuite);
            return $licenseReader->readLicense(MONSTA_LICENSE_PATH);
        }

        private function recordAffiliateSource($licenseEmail) {
            $affiliateChecker = new AffiliateChecker();
            $installUrl = getMonstaInstallUrl();
            $affiliateId = defined("MFTP_AFFILIATE_ID") ? MFTP_AFFILIATE_ID : "";
            return $affiliateChecker->recordAffiliateSource($affiliateId, $licenseEmail, $installUrl);
        }

        public function updateLicense($context) {
            $licenseContent = $context['license'];
            $licenseWriter = new LicenseWriter($licenseContent, PUBKEY_PATH, MONSTA_CONFIG_DIR_PATH . "../license/");
            $licenseData = $licenseWriter->getLicenseData();

            if (!$this->recordAffiliateSource($licenseData['email'])) {
                $licenseWriter->throwInvalidLicenseException();
            }

            $licenseWriter->writeProFiles(dirname(__FILE__) . "/../resources/config_pro_template.php");
        }

        public function getSystemVars() {
            $systemVars = SystemVars::getSystemVarsArray();

            $applicationSettings = new ApplicationSettings(APPLICATION_SETTINGS_PATH);

            $systemVars['applicationSettings'] = $applicationSettings->getSettingsArray();
            return $systemVars;
        }

        public function setApplicationSettings($context) {
            $applicationSettings = new ApplicationSettings(APPLICATION_SETTINGS_PATH);
            $applicationSettings->setFromArray($context['applicationSettings']);
            $applicationSettings->save();
        }

        public function fetchRemoteFile($context) {
            $fetchRequest = new HTTPFetchRequest($context['source'], $context['destination']);
            $fetcher = new HTTPFetcher();
            try {
                $effectiveUrl = $fetcher->fetch($fetchRequest);
                $this->connectAndAuthenticate();

                $transferContext = array(
                    'localPath' => $fetcher->getTempSavePath(),
                    'remotePath' => $fetchRequest->getUploadPath($effectiveUrl)
                );
                $transferOp = TransferOperationFactory::getTransferOperation($this->connectionType, $transferContext);
                $this->connection->uploadFile($transferOp);
            } catch (Exception $e) {
                $fetcher->cleanUp();
                throw $e;
            }

            // this should be done in a finally to avoid repeated code but we need to support PHP < 5.5
            $fetcher->cleanUp();
        }

        public function deleteMultiple($context) {
            $this->connectAndAuthenticate();
            $this->connection->deleteMultiple($context['pathsAndTypes']);
            $this->disconnect();
        }

        public function downloadForExtract($context) {
            $this->connectAndAuthenticate();

            $remotePath = $context["remotePath"];
            $localPath = getTempTransferPath($context["remotePath"]);

            $rawTransferContext = array(
                "remotePath" => $remotePath,
                "localPath" => $localPath
            );

            $transferOp = TransferOperationFactory::getTransferOperation($this->connectionType, $rawTransferContext);
            $this->connection->downloadFile($transferOp);

            $extractor = new ArchiveExtractor($localPath, null);

            $archiveFileCount = $extractor->getFileCount(); // will throw exception if it's not valid

            $fileKey = generateRandomString(16);

            $_SESSION[$fileKey] = array(
                "archivePath" => $localPath,
                "extractDirectory" => PathOperations::remoteDirname($remotePath)
            );

            return array("fileKey" => $fileKey, "fileCount" => $archiveFileCount);
        }

        public function cleanUpExtract($context) {
            $fileKey = $context['fileKey'];

            if (!isset($_SESSION[$fileKey]))
                exitWith404();

            $fileData = $_SESSION[$fileKey];

            if (!isset($fileData['archivePath']))
                exitWith404();

            $archivePath = $fileData['archivePath'];

            @unlink($archivePath); // if this fails not much we can do

            return true;
        }

        public function extractArchive($context) {
            if (!isset($context['fileKey']))
                exitWith404();

            $fileKey = $context['fileKey'];

            $this->connectAndAuthenticate();

            if (!isset($_SESSION[$fileKey]))
                exitWith404();

            $fileInfo = $_SESSION[$fileKey];

            $archivePath = $fileInfo['archivePath'];
            $extractDirectory = $fileInfo['extractDirectory'];

            $extractor = new ArchiveExtractor($archivePath, $extractDirectory);

            try {
                $transferResult = $extractor->extractAndUpload($this->connection,
                    $context['fileIndexOffset'], $context['extractCount']);

                // $transferResult is [isFinalTransfer, itemsTransferred (in this iteration, not total)]
            } catch (Exception $e) {
                // this should be done in a finally to avoid repeated code but we need to support PHP < 5.5
                @unlink($archivePath);
                throw $e;
            }

            if ($transferResult[0]) { // is final transfer
                unset($_SESSION[$fileKey]);
                @unlink($archivePath);
            }

            return $transferResult;
        }

        public function reserveUploadContext($context) {
            $remotePath = $context['remotePath'];

            $localPath = getTempTransferPath($remotePath);

            $sessionKey = MultiStageUploadHelper::storeUploadContext($this->connectionType, $context['actionName'],
                $this->rawConfiguration, $localPath, $remotePath);

            return $sessionKey;
        }

        public function transferUploadToRemote($context) {
            $sessionKey = $context['sessionKey'];
            $uploadContext = MultiStageUploadHelper::getUploadContext($sessionKey);

            $localPath = $uploadContext['localPath'];
            $remotePath = $uploadContext['remotePath'];

            $transferContext = array(
                "localPath" => $localPath,
                "remotePath" => $remotePath
            );

            try {
                $resp = $this->dispatchRequest($uploadContext['actionName'], $transferContext);
                @unlink($localPath);
                unset($_SESSION[$sessionKey]);
                return $resp;
            } catch (Exception $e) {
                @unlink($localPath);
                unset($_SESSION[$sessionKey]);
                throw $e;
            }
        }

        public function getRemoteFileSize($context) {
            $this->connectAndAuthenticate();
            return $this->connection->getFileSize($context['remotePath']);
        }

        public function getDefaultPath() {
            $this->connectAndAuthenticate();
            return $this->connection->getCurrentDirectory();
        }

        public function resetPassword($context) {
            if (!function_exists('mftpResetPasswordHandler')) {
                throw new Exception("mftpResetPasswordHandler function is not defined.");
            }

            return mftpResetPasswordHandler($context['username'], $context['currentPassword'], $context['newPassword']);
        }

        public function forgotPassword($context) {
            if (!function_exists('mftpForgotPasswordHandler')) {
                throw new Exception("mftpForgotPasswordHandler function is not defined.");
            }

            return mftpForgotPasswordHandler($context['username']);
        }
    }