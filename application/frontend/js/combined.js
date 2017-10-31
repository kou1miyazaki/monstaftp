var TRANSFER_RATE_UPDATE_INTERVAL = 200;
var TRANSFER_ITEMS_MIN_UPDATE = 8192;
var TRANSFER_RATE_SAMPLES_MAX = 10;
var TRANSFER_COMPLETE_MODAL_HIDE_DELAY = 700;
var AUTOSAVE_DELAY_MS = 3000;
var MAX_CONCURRENT_UPLOADS = 1;
var MAX_UPLOAD_BYTES = -1;
var UPLOAD_ACTION = 'uploadFileToNewDirectory';
var UPLOAD_ARCHIVE_ACTION = 'uploadArchive';
var API_PATH = 'application/api/api.php';
var DOWNLOAD_PATH = 'application/api/download.php';
var UPLOAD_PATH = 'application/api/upload.php';
var MULTI_STAGE_UPLOAD_PATH = 'application/api/upload-multistage.php';
var CM_MODE_BASE = "//cdnjs.cloudflare.com/ajax/libs/codemirror/5.17.0/mode/";
var DEBUG = false;
var FEATURE_MULTI_STAGE_UPLOAD = false;

var g_ConnectionDefaults = {
    ftp: {
        port: 21
    },
    sftp: {
        port: 22
    }
};

angular.module('MonstaFTP', ['pascalprecht.translate']);

angular.module('MonstaFTP').config(['$httpProvider', function ($httpProvider) {
    'use strict';
    var activeRequestCount = 0;

    $httpProvider.interceptors.push(['$rootScope', '$q', function ($rootScope, $q) {
        var handleActiveRequestChange = function (delta) {
            activeRequestCount += delta;
            $rootScope.$broadcast('request-count-change', activeRequestCount);
        };

        return {
            'request': function (config) {
                if(!config.__ignoreStatusIndicator)
                    handleActiveRequestChange(1);
                return config;
            },
            'responseError': function (rejection) {
                safeConsoleError(rejection);
                if(!rejection.config.__ignoreStatusIndicator)
                    handleActiveRequestChange(-1);
                return $q.reject(rejection);
            },
            'response': function (response) {
                if(!response.config.__ignoreStatusIndicator)
                    handleActiveRequestChange(-1);
                return response;
            }
        };
    }]);
}]);

angular.module('MonstaFTP').config(['$translateProvider', function ($translateProvider) {
    'use strict';
    $translateProvider.useSanitizeValueStrategy('escape');
    if (!window.underTest) { // TODO this is a bit hack
        $translateProvider.useStaticFilesLoader({
            prefix: 'application/languages/',
            suffix: '.json'
        });
    }

    $translateProvider.useMessageFormatInterpolation();
    $translateProvider.fallbackLanguage('en_us');

    if(window.localStorage) {
        try {
            var storedLanguage = localStorage.getItem('monsta-setting-language');
            if(storedLanguage)
                g_defaultLanguage = JSON.parse(storedLanguage);
        } catch (e) {

        }
    }

    $translateProvider.preferredLanguage(g_defaultLanguage);
}]);

angular.module('MonstaFTP').config(['$locationProvider', function($locationProvider) {
    //$locationProvider.html5Mode(false);
    $locationProvider.hashPrefix('');
}]);

function monstaLatestVersionCallback(latestVersion) {
    window.MONSTA_LATEST_VERSION = latestVersion;
    var latestVersionLoadEVent = document.createEvent("CustomEvent");
    latestVersionLoadEVent.initEvent('latestVersionLoadEVent', true, true);
    document.dispatchEvent(latestVersionLoadEVent);
}
(function () {
    angular.module('MonstaFTP').controller('BreadcrumbController', BreadcrumbController);

    BreadcrumbController.$inject = ['$scope', '$rootScope', 'jQuery'];

    function BreadcrumbController($scope, $rootScope, jQuery) {
        var vm = this;

        vm.pathComponents = [];
        vm.hasLeadingSlash = false;
        vm.renderBreadcrumbs = renderBreadcrumbs;

        this.setPath = setPath;
        this.changeDirectoryToItem = changeDirectoryToItem;

        $scope.$on('directory-changed', directoryChanged);

        $scope.$on("logout", function(){
            vm.setPath("/");
        });

        jQuery(window).resize(function () {
            vm.renderBreadcrumbs();
        });

        function linkClick(ev) {
            ev.preventDefault();
            vm.changeDirectoryToItem(jQuery(this).data('index'));
            return false;
        }

        function makeBreadcrumbItem(linkText, index) {
            var $span = jQuery('<li class="breadcrumb-display"></li>');
            var $link = jQuery('<a href="#" data-index="' + index + '"></a>').text(linkText + ' ');
            $link.click(linkClick);
            $span.append($link);
            return $span;
        }

        function renderBreadcrumbs() {
            var RIGHT_COMPONENT_BUFFER = 15, RIGHT_FULL_BUFFER = 120;
            // TODO: cache these elements so they aren't looked up every time
            var $breadcrumbContainer = jQuery("#breadcrumb-ol"), $homeLink = jQuery("#breadcrumb__home_link"),
                historyButton = jQuery('#history > button'), windowWidth = jQuery(window).width(),
                maxWidth = windowWidth - historyButton.width() - RIGHT_FULL_BUFFER, totalWidth = 0;
            $breadcrumbContainer.find('.breadcrumb-display').remove();

            var lastIndex = vm.pathComponents.length - 1, $rightSpan = null;

            for (var i = lastIndex; i >= 0; --i) {
                var component = vm.pathComponents[i];

                var $span = makeBreadcrumbItem(component, i + 1);

                if ($rightSpan === null)
                    $rightSpan = $span;

                $homeLink.after($span);

                totalWidth += $span.outerWidth();

                if (totalWidth > maxWidth) {
                    if (i != lastIndex) {
                        // only remove it if this isn't the first try
                        $span.remove();
                    }

                    if (lastIndex != 0) {
                        var $initialSpan = makeBreadcrumbItem("…", i + 1);
                        $homeLink.after($initialSpan);
                    }
                    break;
                }
            }

            if (totalWidth > maxWidth) {
                var charactersRemoved = 1;

                while ($rightSpan.offset().left + $rightSpan.outerWidth() + RIGHT_COMPONENT_BUFFER > windowWidth) {
                    ++charactersRemoved;
                    var lastComponent = vm.pathComponents[lastIndex], lastComponentLength = lastComponent.length;
                    var trimmedName = lastComponent.substr(0, lastComponentLength - charactersRemoved);
                    trimmedName += "…";
                    $rightSpan.text(trimmedName);
                    if (lastComponentLength - charactersRemoved == 1)
                        break; // this is safety to prevent infinite loops
                }
            }
        }

        function setPath(path) {
            if (typeof(path) != 'string' || path.length == 0) {
                vm.pathComponents = [];
                vm.hasLeadingSlash = false;
                return;
            }

            vm.hasLeadingSlash = path.substr(0, 1) == '/';

            if (path == '/')
                vm.pathComponents = [];
            else {
                vm.pathComponents = path.split('/');
                if (vm.pathComponents[0] == '')
                    vm.pathComponents.splice(0, 1);

                if (vm.pathComponents[vm.pathComponents.length - 1] == '')
                    vm.pathComponents.splice(vm.pathComponents.length - 1, 1);
            }

            vm.renderBreadcrumbs();
        }

        function changeDirectoryToItem(itemIndex) {
            var joinedPath = '';
            if (itemIndex != 0)
                joinedPath = vm.pathComponents.slice(0, itemIndex).join('/');

            var newPath = (vm.hasLeadingSlash ? '/' : '') + joinedPath;
            $rootScope.$broadcast('change-directory', newPath);
        }

        function directoryChanged(ev, path) {
            vm.setPath(path);
        }
    }
}());
(function () {
    angular.module('MonstaFTP').factory('authenticationFactory', authenticationFactory);

    function authenticationFactory() {
        var configurationKey = 'monsta-configuration',
            connectionTypeKey = 'monsta-connectionType',
            initialDirectoryKey = 'monsta-initialDirectory',
            rememberLoginKey = 'monsta-rememberLogin',
            isAuthenticatedKey = 'monsta-isAuthenticated',
            hasServerSavedAuthenticationKey = 'monsta-hasServerSavedAuthentication';

        return {
            isAuthenticated: false,
            rememberLogin: false,
            configuration: null,
            connectionType: null,
            initialDirectory: null,
            hasServerSavedAuthentication: false,
            _localStorageSupported: null,
            getConfigurationAsJSON: function () {
                return JSON.stringify(this.configuration);
            },
            setConfigurationFromJSON: function (jsonConfig) {
                this.configuration = jsonConfig == null ? null : JSON.parse(jsonConfig);
            },
            localStorageSupported: function () {
                if (this._localStorageSupported == null) {
                    var testKey = 'test', storage = window.localStorage;
                    try {
                        storage.setItem(testKey, '1');
                        storage.removeItem(testKey);
                        this._localStorageSupported = true;
                    } catch (error) {
                        this._localStorageSupported = false;
                    }
                }
                return this._localStorageSupported;
            },
            postLogin: function () {
                this.isAuthenticated = true;
                this.saveSettings();
            },
            loadSettings: function () {
                if (!this.localStorageSupported())
                    return;

                this.loadMetaConfiguration();

                if (this.rememberLogin)
                    this.loadConfiguration();
            },
            saveSettings: function () {
                if (!this.localStorageSupported())
                    return;

                this.saveMetaConfiguration();

                if (this.rememberLogin)
                    this.saveConfiguration();
                else
                    this.clearConfiguration();
            },
            clearSettings: function () {
                if (!this.localStorageSupported())
                    return;

                if (!this.rememberLogin)
                    this.clearConfiguration();
            },
            logout: function () {
                this.isAuthenticated = false;
                this.initialDirectory = null;
                this.saveSettings();
                this.clearSettings();  // looks weird, but we want to save all, then clear out ones we don't want
                this.configuration = null;
                // if config has been saved to localStorage, this will be repopulated,  otherwise it clears out the form
            },
            loadConfiguration: function () {
                if (!this.localStorageSupported())
                    return;

                this.setConfigurationFromJSON(localStorage.getItem(configurationKey));
                this.connectionType = localStorage.getItem(connectionTypeKey);
                this.initialDirectory = localStorage.getItem(initialDirectoryKey);
            },
            saveConfiguration: function () {
                if (!this.localStorageSupported())
                    return;

                localStorage.setItem(configurationKey, this.getConfigurationAsJSON());
                localStorage.setItem(connectionTypeKey, this.connectionType);
                localStorage.setItem(initialDirectoryKey, this.initialDirectory);
            },
            clearConfiguration: function () {
                localStorage.removeItem(configurationKey);
                localStorage.removeItem(connectionTypeKey);
                localStorage.removeItem(initialDirectoryKey);
            },
            loadMetaConfiguration: function () {
                if (!this.localStorageSupported())
                    return;

                this.rememberLogin = localStorage.getItem(rememberLoginKey) === 'true';
                this.isAuthenticated = localStorage.getItem(isAuthenticatedKey) === 'true';
                this.hasServerSavedAuthentication = localStorage.getItem(hasServerSavedAuthenticationKey) === 'true';
            },
            saveMetaConfiguration: function () {
                if (!this.localStorageSupported())
                    return;

                localStorage.setItem(isAuthenticatedKey, this.isAuthenticated == true ? 'true' : 'false');
                localStorage.setItem(rememberLoginKey, this.rememberLogin == true ? 'true' : 'false');
                localStorage.setItem(hasServerSavedAuthenticationKey,
                    this.hasServerSavedAuthentication == true ? 'true' : 'false');
            },
            hasStoredAuthenticationDetails: function () {
                return !isEmpty(this.connectionType) && !isEmpty(this.configuration);
            },
            getActiveConfiguration: function () {
                var activeConfiguration = this.configuration[this.connectionType];
                if (typeof(activeConfiguration.port) != 'undefined' && activeConfiguration.port != null)
                    activeConfiguration.port = parseInt(activeConfiguration.port);
                return activeConfiguration;
            }
        };
    }
}());
(function () {
    angular.module('MonstaFTP').factory('codeMirrorFactory', codeMirrorFactory);

    codeMirrorFactory.$inject = ['$window'];

    function codeMirrorFactory($window) {
        var _jQuery = $window.jQuery; // can't inject factory into factory it seems
        return {
            jQuery: _jQuery, // for reference in tests & mocking
            loadedModes: [],
            readOnly: false,
            convertFilenameToMode: function (fileName) {
                var fileExtension = extractFileExtension(fileName);

                var modeLookup = {
                    htm: 'htmlmixed',
                    html: 'htmlmixed',
                    php: 'php',
                    asp: 'htmlembedded',
                    aspx: 'htmlembedded',
                    js: 'javascript',
                    css: 'css',
                    xhtml: 'htmlmixed',
                    cfm: 'htmlembedded',
                    pl: 'perl',
                    py: 'python',
                    c: 'clike',
                    cpp: 'clike',
                    rb: 'ruby',
                    java: 'java',
                    xml: 'xml',
                    json: 'javascript'
                };

                return modeLookup.hasOwnProperty(fileExtension) ? modeLookup[fileExtension] : null;
            },
            getModeDependencies: function (modeName) {
                if (modeName == null)
                    return [];

                var dependencyLookup = {
                    'htmlmixed': ['xml', 'javascript', 'css'],
                    'php': ['xml', 'javascript', 'css', 'htmlmixed', 'clike']
                    // todo: make these work recursively instead of coding all deps in
                };

                return dependencyLookup.hasOwnProperty(modeName) ? dependencyLookup[modeName] : null;
            },
            generateModePath: function (modeName) {
                return CM_MODE_BASE + modeName + "/" + modeName + '.js';
            }, setupCodeMirror: function (modeName, editorElement, postSetupCallback) {
                var cm = CodeMirror.fromTextArea(editorElement, {
                    value: editorElement.value,
                    mode: modeName,
                    lineNumbers: true,
                    lineWrapping: true,
                    readOnly: this.readOnly,
                    autoRefresh: true
                });

                postSetupCallback(cm);
            }, postScriptLoad: function (modeName, editorElement, postSetupCallback) {
                if (this.loadedModes.indexOf(modeName) == -1)
                    this.loadedModes.push(modeName);

                this.setupCodeMirror(modeName, editorElement, postSetupCallback);
            }, loadModeAfterDependencies: function (modeName, editorElement, postSetupCallback) {
                if (modeName === null || this.loadedModes.indexOf(modeName) != -1) {
                    this.setupCodeMirror(modeName, editorElement, postSetupCallback);
                    return;
                }
                var _this = this;
                this.jQuery.getScript(this.generateModePath(modeName), function () {
                    _this.postScriptLoad.call(_this, modeName, editorElement, postSetupCallback);
                });
            }, initiateCodeMirror: function (modeName, editorElement, postSetupCallback) {
                var dependencies = this.getModeDependencies(modeName);

                var neededDependencies = [];

                if (dependencies != null) {
                    for (var i = 0; i < dependencies.length; ++i)
                        if (this.loadedModes.indexOf(dependencies[i]) == -1)
                            neededDependencies.push(dependencies[i]);
                }

                if (neededDependencies.length == 0)
                    this.loadModeAfterDependencies(modeName, editorElement, postSetupCallback);
                else {
                    var dependencyName = neededDependencies[0], _this = this;

                    this.jQuery.getScript(this.generateModePath(dependencyName), function () {
                        _this.loadedModes.push(dependencyName);
                        _this.initiateCodeMirror.call(_this, modeName, editorElement, postSetupCallback);
                    });
                }
            }
        };
    }
}());


(function(){
    angular.module('MonstaFTP').factory('configurationFactory', configurationFactory);

    configurationFactory.$inject = ['connectionFactory', '$q', '$rootScope'];

    function configurationFactory(connectionFactory, $q, $rootScope) {
        var factory = {
            getSystemConfiguration: getSystemConfiguration,
            saveApplicationSettings: saveApplicationSettings,
            setApplicationSetting: setApplicationSetting,
            getApplicationSetting: getApplicationSetting,
            setServerCapability: setServerCapability,
            getServerCapability: getServerCapability
        }, promise = null, lastRequestFailed = false, config = null, allowedPostSettingKeys = ['postLogoutUrl'],
            serverCapabilities = {};

        function getSystemConfiguration() {
            if(promise === null || lastRequestFailed)
                promise = connectionFactory.getSystemVars().then(requestSuccess, requestFailure);

            return promise;
        }

        function requestSuccess(response) {
            config = response.data.data;
            return config;
        }

        function requestFailure(response) {
            lastRequestFailed = true;
            return $q.reject(response);
        }

        function saveApplicationSettings() {
            return connectionFactory.setApplicationSettings(config.applicationSettings);
        }

        function setApplicationSetting(key, value) {
            if (config == null)
                return;

            if (config.applicationSettings == undefined)
                config.applicationSettings = {};

            var keyChanged = config.applicationSettings[key] != value;

            config.applicationSettings[key] = value;

            if(keyChanged)
                $rootScope.$broadcast('configuration:key-changed', key, value);
        }

        function postedSettingExists(key) {
            if(!g_isMonstaPostEntry)
                return false;

            if (allowedPostSettingKeys.indexOf(key) == -1)
                return false;

            if (g_monstaPostEntryVars.settings == undefined)
                return false;

            return g_monstaPostEntryVars.settings[key] != undefined;
        }

        function getPostedSetting(key) {
            return g_monstaPostEntryVars.settings[key];
        }

        function getApplicationSetting(key) {
            if (postedSettingExists(key))
                return getPostedSetting(key);

            if(config == null)
                return null;

            return config.applicationSettings[key];
        }

        function setServerCapability(capabilityName, capabilityValue) {
            if(serverCapabilities[capabilityName] === capabilityValue)
                return;

            serverCapabilities[capabilityName] = capabilityValue;

            $rootScope.$broadcast("server-capability:key-changed", capabilityName, capabilityValue);
        }

        function getServerCapability(capabilityName) {
            return serverCapabilities[capabilityName];
        }

        return factory;
    }
}());
(function () {
    angular.module('MonstaFTP').factory('localConfigurationFactory', localConfigurationFactory);

    localConfigurationFactory.$inject = ['configurationFactory', '$rootScope'];

    function localConfigurationFactory(configurationFactory, $rootScope) {
        var factory = {
            getApplicationSettings: getApplicationSettings,
            getConfigurationItem: getConfigurationItem,
            setConfigurationItem: setConfigurationItem
        };

        var isLocalStorageSupported = null, inMemoryStorage = {}, applicationSettings = {};

        function localStorageSupported() {
            if (isLocalStorageSupported == null) {
                var testKey = 'test', storage = window.localStorage;
                try {
                    storage.setItem(testKey, '1');
                    storage.removeItem(testKey);
                    isLocalStorageSupported = true;
                } catch (error) {
                    isLocalStorageSupported = false;
                }
            }
            return isLocalStorageSupported;
        }

        function getItemFromLocalStorage(key) {
            var rawItem = localStorage.getItem(key);

            if (typeof (rawItem) == "string")
                return JSON.parse(rawItem);

            return rawItem;
        }

        function storeItemInLocalStorage(key, item) {
            localStorage.setItem(key, JSON.stringify(item));
        }

        function storeItem(key, item) {
            key = "monsta-setting-" + key;
            if (localStorageSupported())
                storeItemInLocalStorage(key, item);
            else
                inMemoryStorage[key] = item;
        }

        function getItem(key) {
            key = "monsta-setting-" + key;
            if (localStorageSupported())
                return getItemFromLocalStorage(key);

            return inMemoryStorage[key];
        }

        function getConfigurationItem(key) {
            if(getItem(key) == undefined)
                return applicationSettings[key];

            return getItem(key);
        }

        function getApplicationSettings() {
            return configurationFactory.getSystemConfiguration().then(function (systemVars) {
                applicationSettings = systemVars.applicationSettings;
            }, requestFailure);
        }

        function setConfigurationItem(key, item) {
            var keyChanged = getItem(key) != item;

            storeItem(key, item);

            if(keyChanged)
                $rootScope.$broadcast('configuration:key-changed', key, item);
        }

        function requestFailure(response) {
            return $q.reject(response);
        }

        return factory;
    }
}());


(function () {
    angular.module('MonstaFTP').factory('connectionFactory', connectionFactory);

    connectionFactory.$inject = ['$http', 'authenticationFactory', '$q'];

    function connectionFactory($http, authenticationFactory, $q) {
        var NETWORK_TIMEOUT_SECONDS = window.g_xhrTimeoutSeconds || 30;
        var IGNORE_TIMEOUT_TYPES = [
            "downloadMultipleFiles",
            "fetchFile",
            "fetchRemoteFile",
            "copy",
            "extractArchive",
            "deleteMultiple",
            "transferUploadToRemote"
        ];

        var addRemoteFileRequest = function (request, actionName, remotePath) {
            request['actionName'] = actionName;
            request['context'] = {
                'remotePath': remotePath
            };
        };

        var addSourceDestinationRequest = function (request, actionName, source, destination) {
            request['actionName'] = actionName;
            request['context'] = {
                'source': source,
                'destination': destination
            };
        };

        return {
            _sendRequest: function (requestBody, ignoreStatusIndicator, addCancel) {
                var timeoutTime = IGNORE_TIMEOUT_TYPES.indexOf(requestBody.actionName) == -1 ? NETWORK_TIMEOUT_SECONDS * 1000 : null, timeOut;

                if (addCancel) {
                    var canceller = $q.defer();

                    var cancel = function (reason) {
                        canceller.resolve(reason);
                    };

                    timeOut = canceller.promise;
                } else {
                    timeOut = timeoutTime;
                }

                var req = {
                    method: 'POST',
                    url: API_PATH,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    transformRequest: function (obj) {
                        var str = [];
                        for (var p in obj) {
                            if (!obj.hasOwnProperty(p))
                                continue;
                            str.push(encodeURIComponent(p) + "=" + encodeURIComponent(JSON.stringify(obj[p])));
                        }
                        return str.join("&");
                    },
                    timeout: timeOut,
                    data: {
                        request: requestBody
                    },
                    __ignoreStatusIndicator: !!ignoreStatusIndicator
                };

                if (DEBUG)
                    console.log(req);

                var promise = $http(req);

                if(addCancel) {
                    return {
                        promise: promise,
                        cancel: cancel
                    }
                }

                return promise;
            },
            getRequestBody: function () {
                var config = angular.copy(authenticationFactory.getActiveConfiguration());

                var defaultsForConnectionType = g_ConnectionDefaults[authenticationFactory.connectionType];

                if (defaultsForConnectionType) {
                    for (var defaultName in defaultsForConnectionType) {
                        if (!defaultsForConnectionType.hasOwnProperty(defaultName))
                            continue;

                        if (config[defaultName] == null || config[defaultName] == undefined || config[defaultName] == '')
                            config[defaultName] = defaultsForConnectionType[defaultName];
                    }
                }

                return {
                    connectionType: authenticationFactory.connectionType,
                    configuration: config
                };
            },
            getEmptyRequestBody: function () {
                return {connectionType: null, configuration: null};
            },
            getListDirectoryRequest: function (request, path, showHidden) {
                request['actionName'] = 'listDirectory';
                request['context'] = {
                    path: path,
                    showHidden: showHidden
                };
            },
            getFetchFileRequest: function (request, remotePath) {
                addRemoteFileRequest(request, 'fetchFile', remotePath);
            },
            getMakeDirectoryRequest: function (request, remotePath) {
                addRemoteFileRequest(request, 'makeDirectory', remotePath);
            },
            getDeleteDirectoryRequest: function (request, remotePath) {
                addRemoteFileRequest(request, 'deleteDirectory', remotePath);
            },
            getDeleteFileRequest: function (request, remotePath) {
                addRemoteFileRequest(request, 'deleteFile', remotePath);
            },
            getCopyRequest: function (request, source, destination) {
                addSourceDestinationRequest(request, 'copy', source, destination);
            },
            getRenameRequest: function (request, source, destination) {
                addSourceDestinationRequest(request, 'rename', source, destination);
            },
            getChangePermissionsRequest: function (request, remotePath, mode) {
                addRemoteFileRequest(request, 'changePermissions', remotePath);
                request['context']['mode'] = mode;
            },
            getPutFileContentsRequest: function (request, remotePath, fileContents, encodeContents) {
                request['actionName'] = 'putFileContents';
                request['context'] = {remotePath: remotePath, fileContents: fileContents};

                if (encodeContents)
                    request['context']['encoding'] = 'rot13';
            },
            getGetFileContentsRequest: function (request, remotePath) {
                request['actionName'] = 'getFileContents';
                request['context'] = {remotePath: remotePath};
            },
            getTestConnectAndAuthenticateRequest: function (request, getServerCapabilities) {
                request['actionName'] = 'testConnectAndAuthenticate';
                request['context'] = {
                    getServerCapabilities: getServerCapabilities
                }
            },
            getCheckSavedAuthExistsRequest: function (request) {
                request['actionName'] = 'checkSavedAuthExists';
                request['context'] = {};
            },
            getWriteSavedAuthRequest: function (request, password, authData) {
                request['actionName'] = 'writeSavedAuth';
                request['context'] = {
                    password: password,
                    authData: authData
                };
            },
            getReadSavedAuthRequest: function (request, password) {
                request['actionName'] = 'readSavedAuth';
                request['context'] = {
                    password: password
                };
            },
            getReadLicenseRequest: function (request) {
                request['actionName'] = 'readLicense';
                request['context'] = {};
            },
            getGetSystemVarsRequest: function (request) {
                request['actionName'] = 'getSystemVars';
                request['context'] = {};
            },
            getFetchRemoteFileRequest: function (request, remoteSource, destinationDirectory) {
                addSourceDestinationRequest(request, 'fetchRemoteFile', remoteSource, destinationDirectory);
            },
            getDownloadMultipleFilesRequest: function (request, baseDirectory, items) {
                request['actionName'] = 'downloadMultipleFiles';
                request['context'] = {baseDirectory: baseDirectory, items: items};
            },
            getSetApplicationSettingsRequest: function (request, applicationSettings) {
                request['actionName'] = 'setApplicationSettings';
                request['context'] = {applicationSettings: applicationSettings};
            },
            getDeleteMultipleRequest: function (request, pathsAndTypes) {
                request['actionName'] = 'deleteMultiple';
                request['context'] = {pathsAndTypes: pathsAndTypes};
            },
            getExtractArchiveRequest: function (request, fileKey, fileIndexOffset, extractCount) {
                request['actionName'] = 'extractArchive';
                request['context'] = {fileKey: fileKey, fileIndexOffset: fileIndexOffset, extractCount: extractCount};
            },
            getUpdateLicenseRequest: function (request, license) {
                request['actionName'] = 'updateLicense';
                request['context'] = {license: license};
            },
            getReserveUploadContextRequest: function (request, actionName, remotePath) {
                request['actionName'] = 'reserveUploadContext';
                request['context'] = {actionName: actionName, remotePath: remotePath};
            },
            getTransferUploadToRemoteRequest: function (request, sessionKey) {
                request['actionName'] = 'transferUploadToRemote';
                request['context'] = {sessionKey: sessionKey};
            },
            getGetRemoteFileSizeRequest: function (request, remotePath) {
                request['actionName'] = 'getRemoteFileSize';
                request['context'] = {remotePath: remotePath};
            },
            getGetDefaultPathRequest: function (request) {
                request['actionName'] = 'getDefaultPath';
            },
            getDownloadForExtractRequest: function (request, remotePath) {
                request['actionName'] = 'downloadForExtract';
                request['context'] = {remotePath: remotePath};
            },
            getCleanUpExtractRequest: function (request, fileKey) {
                request['actionName'] = 'cleanUpExtract';
                request['context'] = {fileKey: fileKey};
            },
            getForgotPasswordRequest: function (request, username) {
                request['actionName'] = 'forgotPassword';
                request['context'] = {username: username};
            },
            getResetPasswordRequest: function (request, username, currentPassword, newPassword) {
                request['actionName'] = 'resetPassword';
                request['context'] = {username: username, currentPassword: currentPassword, newPassword: newPassword};
            },
            listDirectory: function (path, showHidden) {
                this.requestBody = this.getRequestBody();
                this.getListDirectoryRequest(this.requestBody, path, showHidden);
                return this._sendRequest(this.requestBody);
            },
            fetchFile: function (path) {
                this.requestBody = this.getRequestBody();
                this.getFetchFileRequest(this.requestBody, path, true);
                return this._sendRequest(this.requestBody);
            },
            rename: function (source, destination) {
                this.requestBody = this.getRequestBody();
                this.getRenameRequest(this.requestBody, source, destination);
                return this._sendRequest(this.requestBody);
            },
            changePermissions: function (path, mode) {
                this.requestBody = this.getRequestBody();
                this.getChangePermissionsRequest(this.requestBody, path, mode);
                return this._sendRequest(this.requestBody);
            },
            copy: function (source, destination) {
                this.requestBody = this.getRequestBody();
                this.getCopyRequest(this.requestBody, source, destination);
                return this._sendRequest(this.requestBody);
            },
            deleteFile: function (path) {
                this.requestBody = this.getRequestBody();
                this.getDeleteFileRequest(this.requestBody, path);
                return this._sendRequest(this.requestBody);
            },
            deleteDirectory: function (path) {
                this.requestBody = this.getRequestBody();
                this.getDeleteDirectoryRequest(this.requestBody, path);
                return this._sendRequest(this.requestBody);
            },
            makeDirectory: function (path) {
                this.requestBody = this.getRequestBody();
                this.getMakeDirectoryRequest(this.requestBody, path);
                return this._sendRequest(this.requestBody);
            },
            getFileContents: function (path) {
                this.requestBody = this.getRequestBody();
                this.getGetFileContentsRequest(this.requestBody, path);
                return this._sendRequest(this.requestBody);
            },
            putFileContents: function (path, contents, ignoreStatusIndicator, encodeContents) {
                this.requestBody = this.getRequestBody();

                var b64EncodedContents = b64EncodeUnicode(contents);
                var bodyPayload = encodeContents ? rot13(b64EncodedContents) : b64EncodedContents;
                this.getPutFileContentsRequest(this.requestBody, path, bodyPayload, encodeContents);
                return this._sendRequest(this.requestBody, ignoreStatusIndicator);
            },
            testConnectAndAuthenticate: function (getServerCapabilities) {
                this.requestBody = this.getRequestBody();
                this.getTestConnectAndAuthenticateRequest(this.requestBody, getServerCapabilities);
                return this._sendRequest(this.requestBody);
            },
            checkSavedAuthExists: function () {
                this.requestBody = this.getEmptyRequestBody();
                this.getCheckSavedAuthExistsRequest(this.requestBody);
                return this._sendRequest(this.requestBody);
            }, writeSavedAuth: function (password, authData) {
                this.requestBody = this.getEmptyRequestBody();
                this.getWriteSavedAuthRequest(this.requestBody, password, authData);
                return this._sendRequest(this.requestBody);
            }, readSavedAuth: function (password) {
                this.requestBody = this.getEmptyRequestBody();
                this.getReadSavedAuthRequest(this.requestBody, password);
                return this._sendRequest(this.requestBody);
            }, getLicense: function () {
                this.requestBody = this.getEmptyRequestBody();
                this.getReadLicenseRequest(this.requestBody);
                return this._sendRequest(this.requestBody);
            }, getSystemVars: function () {
                this.requestBody = this.getEmptyRequestBody();
                this.getGetSystemVarsRequest(this.requestBody);
                return this._sendRequest(this.requestBody);
            }, fetchRemoteFile: function (remoteSource, destinationDirectory) {
                this.requestBody = this.getRequestBody();
                this.getFetchRemoteFileRequest(this.requestBody, remoteSource, destinationDirectory);
                return this._sendRequest(this.requestBody);
            }, downloadMultipleFiles: function (baseDirectory, items) {
                this.requestBody = this.getRequestBody();
                this.getDownloadMultipleFilesRequest(this.requestBody, baseDirectory, items);
                return this._sendRequest(this.requestBody);
            }, setApplicationSettings: function (applicationSettings) {
                this.requestBody = this.getRequestBody();
                this.getSetApplicationSettingsRequest(this.requestBody, applicationSettings);
                return this._sendRequest(this.requestBody);
            }, deleteMultiple: function (pathsAndTypes) {
                this.requestBody = this.getRequestBody();
                this.getDeleteMultipleRequest(this.requestBody, pathsAndTypes);
                return this._sendRequest(this.requestBody);
            }, extractArchive: function (fileKey, fileIndexOffset, extractCount) {
                this.requestBody = this.getRequestBody();
                this.getExtractArchiveRequest(this.requestBody, fileKey, fileIndexOffset, extractCount);
                return this._sendRequest(this.requestBody, true, true);
            }, updateLicense: function (license) {
                this.requestBody = this.getRequestBody();
                this.getUpdateLicenseRequest(this.requestBody, license);
                return this._sendRequest(this.requestBody);
            }, reserveUploadContext: function (actionName, remotePath) {
                this.requestBody = this.getRequestBody();
                this.getReserveUploadContextRequest(this.requestBody, actionName, remotePath);
                return this._sendRequest(this.requestBody);
            }, transferUploadToRemote: function (sessionKey) {
                this.requestBody = this.getRequestBody();
                this.getTransferUploadToRemoteRequest(this.requestBody, sessionKey);
                return this._sendRequest(this.requestBody);
            }, getRemoteFileSize: function (remotePath) {
                this.requestBody = this.getRequestBody();
                this.getGetRemoteFileSizeRequest(this.requestBody, remotePath);
                return this._sendRequest(this.requestBody);
            }, getDefaultPath: function () {
                this.requestBody = this.getRequestBody();
                this.getGetDefaultPathRequest(this.requestBody);
                return this._sendRequest(this.requestBody);
            }, downloadForExtract: function (remotePath) {
                this.requestBody = this.getRequestBody();
                this.getDownloadForExtractRequest(this.requestBody, remotePath);
                return this._sendRequest(this.requestBody);
            }, cleanUpExtract: function (fileKey) {
                this.requestBody = this.getRequestBody();
                this.getCleanUpExtractRequest(this.requestBody, fileKey);
                return this._sendRequest(this.requestBody);
            }, forgotPassword: function (username) {
                this.requestBody = this.getRequestBody();
                this.getForgotPasswordRequest(this.requestBody, username);
                return this._sendRequest(this.requestBody);
            },
            resetPassword: function (username, currentPassword, newPassword) {
                this.requestBody = this.getRequestBody();
                this.getResetPasswordRequest(this.requestBody, username, currentPassword, newPassword);
                return this._sendRequest(this.requestBody);
            }
        };
    }
}());
(function () {
    angular.module('MonstaFTP').factory('directorySortingFactory', directorySortingFactory);

    function directorySortingFactory() {
        var compareByDirectoryFlag = function (a, b) {
            if (a.isDirectory == b.isDirectory)
                return 0;

            return a.isDirectory ? -1 : 1;
        };

        var compareByName = function (a, b) {
            var directoryCompare = compareByDirectoryFlag(a, b);
            if (directoryCompare != 0)
                return directoryCompare;

            if (a.name.toLowerCase() == b.name.toLowerCase())
                return 0;

            return a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1;
        };

        var compareByModificationDate = function (a, b) {
            var directoryCompare = compareByDirectoryFlag(a, b);
            if (directoryCompare != 0)
                return directoryCompare;

            if (a.modificationDate != b.modificationDate)
                return a.modificationDate - b.modificationDate;

            return compareByName(a, b);
        };

        var compareBySize = function (a, b) {
            var directoryCompare = compareByDirectoryFlag(a, b);
            if (directoryCompare != 0)
                return directoryCompare;

            if (a.size != b.size)
                return a.size - b.size;

            return compareByName(a, b);
        };

        var compareByType = function (a, b) {
            var directoryCompare = compareByDirectoryFlag(a, b);
            if (directoryCompare != 0)
                return directoryCompare;

            var aExt = extractFileExtension(a.name), bExt = extractFileExtension(b.name);
            if (aExt != bExt)
                return aExt > bExt ? 1 : -1;

            return compareByName(a, b);
        };

        return {
            _handleReverse: function (sortedList, reverse) {
                if (reverse)
                    sortedList.reverse();

                return sortedList;
            },
            sortByName: function (unsortedList, reverse) {
                return this._handleReverse(unsortedList.sort(compareByName), reverse);
            },
            sortByModificationDate: function (unsortedList, reverse) {
                return this._handleReverse(unsortedList.sort(compareByModificationDate), reverse);
            },
            sortBySize: function (unsortedList, reverse) {
                return this._handleReverse(unsortedList.sort(compareBySize), reverse);
            },
            sortByType: function (unsortedList, reverse) {
                return this._handleReverse(unsortedList.sort(compareByType), reverse);
            }
        };
    }
}());
(function () {
    angular.module('MonstaFTP').controller('DragDropController', DragDropController);

    DragDropController.$inject = ['uploadUIFactory', 'jQuery', '$scope', 'licenseFactory', 'configurationFactory',
        '$rootScope'];

    function DragDropController(uploadUIFactory, jQuery, $scope, licenseFactory, configurationFactory, $rootScope) {
        'use strict';
        var overDrop = false, vm = this, $html = jQuery('html'), archiveUploadAllowed = licenseFactory.isLicensed(),
            enableFileUpload = true, enableFolderUpload = true, enableArchiveUpload = true;
        // these might be turned off by the user via the footer

        vm.handleDropEvent = handleDropEvent;

        $scope.$on('license-loaded', function () {
            archiveUploadAllowed = licenseFactory.isLicensed();

            configurationFactory.getSystemConfiguration().then(function () {
                if (licenseFactory.isLicensed()) {
                    archiveUploadAllowed = true;

                    var footerItemDisplay = normalizeFooterDisplayOptions(
                        configurationFactory.getApplicationSetting('footerItemDisplay') || {}
                    ); // footer items for upload set what uploads are allowed

                    enableFileUpload = footerItemDisplay['upload-file'] !== false;
                    enableFolderUpload = footerItemDisplay['upload-folder'] !== false;
                    enableArchiveUpload = footerItemDisplay['upload-archive'] !== false;
                } else {
                    archiveUploadAllowed = false;
                }
            }, function (response) {

            });

        });

        $html.ready(function () {
            var $fileDrop = jQuery("#file-xfer-drop");
            $html.on('dragenter', function () {
                if (!enableFileUpload && !enableFolderUpload && !enableArchiveUpload) {
                    return;
                }

                var $files = jQuery('#files');

                $fileDrop.css({
                    top: $files.position().top,
                    height: $files.height(),
                    display: "table"
                });

                $fileDrop.show();
            });

            $html.on('dragend', function () {
                if (!enableFileUpload && !enableFolderUpload && !enableArchiveUpload) {
                    return;
                }

                if (overDrop)
                    return;

                $fileDrop.hide();
            });

            $fileDrop.ready(function () {
                $fileDrop.on({
                    dragenter: function (e) {
                        if (!enableFileUpload && !enableFolderUpload && !enableArchiveUpload) {
                            return;
                        }

                        overDrop = true;
                        e.stopPropagation();
                        e.preventDefault();
                    },
                    dragleave: function (e) {
                        if (!enableFileUpload && !enableFolderUpload && !enableArchiveUpload) {
                            return;
                        }

                        if (!jQuery.contains($fileDrop, jQuery(e.target)))
                            overDrop = false;
                        e.stopPropagation();
                        e.preventDefault();
                        $fileDrop.hide();
                    },
                    dragover: function (e) {
                        if (!enableFileUpload && !enableFolderUpload && !enableArchiveUpload) {
                            return;
                        }

                        e.stopPropagation();
                        e.preventDefault();
                    },
                    drop: function (e) {
                        if (!enableFileUpload && !enableFolderUpload && !enableArchiveUpload) {
                            return;
                        }

                        overDrop = false;
                        e.stopPropagation();
                        e.preventDefault();

                        var browserEvent = e.originalEvent;
                        if (!browserEvent.dataTransfer || !browserEvent.dataTransfer.files)
                            return false;

                        if (!containsFiles(browserEvent))
                            return false;

                        vm.handleDropEvent(browserEvent);
                        $fileDrop.hide();
                    },
                    dragend: function (e) {
                        if (!enableFileUpload && !enableFolderUpload && !enableArchiveUpload) {
                            return;
                        }

                        e.stopPropagation();
                        e.preventDefault();
                        $fileDrop.hide();
                    }
                });
            });
        });

        function containsFiles(browserEvent) {
            if (browserEvent.dataTransfer.types) {
                for (var i = 0; i < browserEvent.dataTransfer.types.length; i++) {
                    if (browserEvent.dataTransfer.types[i] == "Files") {
                        return true;
                    }
                }

                return false;
            }
        }

        function iterateItemsList(items, requireAllTrue, testFunction) {
            for (var itemIndex = 0; itemIndex < items.length; ++itemIndex) {
                var item = items[itemIndex];

                if (testFunction(item)) {
                    if (!requireAllTrue)
                        return true;
                } else if (requireAllTrue) {
                    return false;
                }
            }

            return requireAllTrue;
        }

        function dataTransferItemsContainsTrueKey(items, key) {
            return iterateItemsList(items, false, function (item) {
                return item.webkitGetAsEntry()[key] === true;
            });
        }

        function dataTransferItemsContainsFolder(items) {
            return dataTransferItemsContainsTrueKey(items, 'isDirectory');
        }

        function dataTransferItemsContainsFile(items) {
            return dataTransferItemsContainsTrueKey(items, 'isFile');
        }

        function dataTransferItemsAllArchive(items) {
            return iterateItemsList(items, true, function (item) {
                return isArchiveFilename(item.webkitGetAsEntry()["name"]);
            });
        }

        function dataTransferFilesAllArchive(files) {
            return iterateItemsList(files, true, function (file) {
                return isArchiveFilename(file["name"]);
            });
        }

        function handleDropEvent(event) {
            event.preventDefault();

            var showFileError = false;

            var items = event.dataTransfer.items;

            var archiveUploadDisabled = (archiveUploadAllowed === false || enableArchiveUpload === false);

            var forceArchiveExtract = null;

            if (items != undefined) {
                if (enableFolderUpload === false && dataTransferItemsContainsFolder(items)) {
                    $rootScope.$broadcast("modal-error:show", "FOLDER_UPLOAD_DISABLED");
                    return; // folder upload not allowed
                }

                if (enableFileUpload === false && dataTransferItemsContainsFile(items)) {
                    showFileError = true;

                    if (enableArchiveUpload !== false) {
                        if (dataTransferItemsAllArchive(items)) {
                            showFileError = false;
                            forceArchiveExtract = true;
                        }
                    }

                    if (showFileError) {
                        $rootScope.$broadcast("modal-error:show", "FILE_UPLOAD_DISABLED");
                        return; // file upload now allowed
                    }
                }

                uploadUIFactory.handleItemsBasedUpload(items, archiveUploadDisabled ? false : forceArchiveExtract);
            } else {
                var files = event.dataTransfer.files;

                if (enableFileUpload === false) {
                    showFileError = true;

                    if (enableArchiveUpload !== false) {
                        if (dataTransferFilesAllArchive(files)) {
                            showFileError = false;
                            forceArchiveExtract = true;
                        }
                    }
                }

                if (showFileError) {
                    $rootScope.$broadcast("modal-error:show", "FILE_UPLOAD_DISABLED");
                    return; // file upload not allowed
                }

                // for IE this needs to be re-referenced, if passing it directly it empties
                uploadUIFactory.handleFilesBasedUpload(files, archiveUploadDisabled ? false : forceArchiveExtract);
            }
        }
    }
}());
(function () {
    angular.module('MonstaFTP').controller('FileBrowserController', FileBrowserController);


    FileBrowserController.$inject = ['$scope', '$rootScope', 'connectionFactory', 'uiOperationFactory', '$window',
        'authenticationFactory', 'historyFactory', 'jQuery', '$timeout', 'directorySortingFactory', '$translate',
        'selectedItemsFactory', 'configurationFactory', 'localConfigurationFactory', 'rowMouseTrackerFactory',
        'licenseFactory', 'uploadFactory'];

    function FileBrowserController($scope, $rootScope, connectionFactory, uiOperationFactory, $window,
                                   authenticationFactory, historyFactory, jQuery, $timeout, directorySortingFactory,
                                   $translate, selectedItemsFactory, configurationFactory, localConfigurationFactory,
                                   rowMouseTrackerFactory, licenseFactory, uploadFactory) {
        'use strict';
        var vm = this, CONTEXT_MENU_X_OFFSET = 7, CONTEXT_MENU_Y_OFFSET = 14, CONTEXT_MENU_INSET = 20,
            loggedIn = false, editableExtensions = [], currentContextMenu = null, preventRowDeselect = false,
            allContextMenuItems = [
                "open",
                "edit",
                "view",
                "download",
                "cut",
                "copy",
                "rename",
                "delete",
                "chmod",
                "properties",
                "extract"
            ], isShouldHideContextMenu = null;

        var FOLDER_TYPE = 'FOLDER', FILE_TYPE = 'FILE';

        $scope.directoryList = [];
        $scope.selectedItems = selectedItemsFactory.getSelectedItems();
        $scope.directoriesToDelete = null;
        $scope.filesToDelete = null;
        $scope.isHistoryChangeDir = false;
        vm.sortName = 'name';
        vm.sortReversed = false;
        vm.renameSource = null;
        vm.rowDragStartIndex = null;
        vm.isMetaDrag = false;
        vm.previousDragOverIndex = null;
        vm.uiOperationFactory = uiOperationFactory;
        vm.systemVars = null;
        vm.enableChmod = true;
        vm.enableFileView = true;
        vm.enableFileEdit = true;
        vm.allowFileCreation = false;
        vm.archiveUploadAllowed = licenseFactory.isLicensed();
        vm.contextMenuItemDisplay = {};
        vm.browserColumnDisplay = {};

        vm.didLogout = didLogout;
        vm.doReorder = doReorder;
        vm.cancelDelete = cancelDelete;
        vm.performPaste = performPaste;
        vm.confirmDelete = confirmDelete;
        vm.deleteComplete = deleteComplete;
        vm.downloadSingle = downloadSingle;
        vm.initiateRename = initiateRename;
        vm.changeDirectory = changeDirectory;
        vm.downloadMultiple = downloadMultiple;
        vm.getSelectedPaths = getSelectedPaths;
        vm.initiateMakeItem = initiateMakeItem;
        vm.showDeleteConfirm = showDeleteConfirm;
        vm.sortDirectoryList = sortDirectoryList;
        vm.downloadFileAtPath = downloadFileAtPath;
        vm.fileRenameCallback = fileRenameCallback;
        vm.initiateCutOfPaths = initiateCutOfPaths;
        vm.makeItemOKCallback = makeItemOKCallback;
        vm.handleReorderChange = handleReorderChange;
        vm.initiateCopyOfPaths = initiateCopyOfPaths;
        vm.directoryListSuccess = directoryListSuccess;
        vm.refreshDirectoryList = refreshDirectoryList;
        vm.downloadSelectedFiles = downloadSelectedFiles;
        vm.handleChangeDirectory = handleChangeDirectory;
        vm.makeItemSuccessCallback = makeItemSuccessCallback;
        vm.makeItemFailureCallback = makeItemFailureCallback;
        vm.setupContextMenuEvents = setupContextMenuEvents;
        vm.initiateCutOfSelectedPaths = initiateCutOfSelectedPaths;
        vm.initiateCopyOfSelectedPaths = initiateCopyOfSelectedPaths;
        vm.initiateChmodOfSelectedItems = initiateChmodOfSelectedItems;
        vm.initiateDeleteOfSelectedPaths = initiateDeleteOfSelectedPaths;
        vm.initiateChmodOfItem = initiateChmodOfItem;

        vm.rowMouseDown = rowMouseDown;
        vm.rowMouseMove = rowMouseMove;
        vm.rowMouseUp = rowMouseUp;
        vm.rowMouseLeave = rowMouseLeave;

        vm.setEditableExtensions = setEditableExtensions;
        vm.itemIsEditable = itemIsEditable;
        vm.navigateUpOneLevel = navigateUpOneLevel;
        vm.showProperties = showProperties;
        vm.handleBodyClick = handleBodyClick;
        vm.getPasteName = getPasteName;
        vm.contextMenuItemHidden = contextMenuItemHidden;
        vm.shouldHideContextMenu = shouldHideContextMenu;
        vm.browserColumnHidden = browserColumnHidden;
        vm.initiateArchiveExtract = initiateArchiveExtract;
        vm.isArchiveFilename = isArchiveFilename;

        $scope.editItem = function (item) {
            var fullFilePath = uiOperationFactory.joinNameToCurrentDirectory(item.name);
            $rootScope.$broadcast('file-editor:edit', item.name, fullFilePath);
        };

        $scope.initiateRenameOfItem = function (item) {
            vm.renameSource = item.name;
            vm.initiateRename();
        };

        $scope.$on('change-directory:on-history', function (ev, path) {
            $scope.isHistoryChangeDir = true;
            vm.handleChangeDirectory(path);
        });

        $scope.$on('change-directory', function (ev, path) {
            $scope.isHistoryChangeDir = false;
            vm.handleChangeDirectory(path);
        });

        $scope.$on('change-directory:on-upload', function () {
            vm.handleChangeDirectory(null, true)
        });

        $scope.$on("server-capability:key-changed", function(ev, capabilityName, capabilityValue){
           if(capabilityName == "changePermissions") {
               vm.enableChmod = vm.enableChmod && capabilityValue;
           }
        });

        $scope.handleClick = function ($event, index) {
            if ($event.ctrlKey || $event.metaKey || $event.shiftKey)
                return;

            $event.stopPropagation();
            var item = this.item;
            if (item.isDirectory) {
                var directoryPath = uiOperationFactory.joinNameToCurrentDirectory(item.name);
                vm.changeDirectory(directoryPath);
            } else {
                jQuery($event.target.parentNode.parentNode).find('.context-catcher-button').dropdown('toggle');
                selectedItemsFactory.selectItem(index);
            }
        };

        $scope.$on('footer-button-click', function (ev, buttonName) {
            // todo: this doesn't necessarily need to be here as it's a $rootScope.$bc so available anywhere
            switch (buttonName) {
                case 'download':
                    vm.downloadSelectedFiles();
                    break;
                case 'cut':
                    vm.initiateCutOfSelectedPaths();
                    break;
                case 'copy':
                    vm.initiateCopyOfSelectedPaths();
                    break;
                case 'paste':
                    vm.performPaste();
                    break;
                case 'delete':
                    vm.initiateDeleteOfSelectedPaths();
                    break;
                case 'new-folder':
                    vm.initiateMakeItem('FOLDER');
                    break;
                case 'new-file':
                    vm.initiateMakeItem('FILE');
                    break;
                case 'chmod':
                    vm.initiateChmodOfSelectedItems();
                    break;
                default:
                    break;
            }
        });

        function postLogin() {
            if (vm.systemVars != null && loggedIn == true)
                vm.changeDirectory(authenticationFactory.initialDirectory == null ? "/" :
                    authenticationFactory.initialDirectory, true);
        }

        $scope.$on('license-loaded', function () {
            configurationFactory.getSystemConfiguration().then(systemVarLoadSuccess, systemVarLoadFailure);
        });

        $scope.$on('login', function () {
            loggedIn = true;
            postLogin();
        });

        $scope.$on('selected-items-changed', function () {
            $scope.selectedItems = selectedItemsFactory.getSelectedItems();
        });

        $scope.$on('logout', function () {
            vm.didLogout();
        });

        $scope.$on('configuration:key-changed', function (ev, key, value) {
            if (key == 'editableFileExtensions') {
                vm.setEditableExtensions(value);
            }
        });

        function contextMenuStyleForEvent(ev) {
            return {
                position: "fixed",
                left: ev.clientX + CONTEXT_MENU_X_OFFSET + "px",
                top: ev.clientY + CONTEXT_MENU_Y_OFFSET + "px",
                'margin-left': 0,
                'margin-top': 0
            };
        }

        function fixContextMenuOffScreen(event, $dropdownMenu) {
            if (elementWillExtendPastWindowWidth(event.clientX + CONTEXT_MENU_X_OFFSET, $dropdownMenu))
                $dropdownMenu.css("margin-left", -($dropdownMenu.width() + CONTEXT_MENU_INSET));

            if (elementWillExtendPastWindowHeight(event.clientY + CONTEXT_MENU_Y_OFFSET, $dropdownMenu))
                $dropdownMenu.css("margin-top", -($dropdownMenu.height() + CONTEXT_MENU_INSET));
        }

        function setupContextMenuEvents() {
            jQuery(".context-catcher-tr").contextmenu(function (e) {
                var $tr = jQuery(this);
                var $dropdownMenu = $tr.find('.dropdown-menu').first();
                var rowIndex = $tr.data('index');
                preventRowDeselect = selectedItemsFactory.getSelectedItems().indexOf(rowIndex) != -1;
                $dropdownMenu.css(contextMenuStyleForEvent(e));

                jQuery(this).find('.context-catcher-button').dropdown('toggle');

                fixContextMenuOffScreen(e, $dropdownMenu);

                if (["DIV", "TR", "TD"].indexOf(e.target.tagName) == -1)
                    selectedItemsFactory.selectItem(rowIndex);

                return false;
            });

            var $fileToobar = jQuery('.file-toolbar');

            jQuery('.context-catcher-button').click(function () {
                var $tr = $(this).parent().parent().parent();
                var rowIndex = $tr.data('index');
                selectedItemsFactory.selectItem(rowIndex);
                $scope.$apply();
            });

            $fileToobar.on('shown.bs.dropdown', function () {
                var $dropdownMenu = jQuery(this).find('.dropdown-menu');
                currentContextMenu = $dropdownMenu;
                var $dropDownMenuParent = $dropdownMenu.parent().removeClass('dropup');

                if ($dropdownMenu.css('position') == 'fixed')  // it was shown with rightclick so don't mess with it
                    return;

                if ($dropdownMenu.offset().top + $dropdownMenu.outerHeight() > jQuery(window).height() - jQuery("#footer").height())
                    $dropDownMenuParent.addClass('dropup');
            });

            $fileToobar.on('hidden.bs.dropdown', function () {
                var $contextCatcherUl = jQuery(this).find('.dropdown-menu');
                $contextCatcherUl.attr('style', null);
                currentContextMenu = null;
            });
        }

        function elementWillExtendPastWindowWidth(xOffset, $element) {
            return xOffset + $element.width() > jQuery(window).width();
        }

        function elementWillExtendPastWindowHeight(yOffset, $element) {
            return yOffset + $element.height() > jQuery(window).height()
        }

        function doReorder() {
            $scope.directoryList = vm.sortDirectoryList($scope.directoryList, vm.sortName, vm.sortReversed);
        }

        function handleReorderChange(newSortName) {
            vm.sortReversed = newSortName == vm.sortName ? !vm.sortReversed : false;
            vm.sortName = newSortName;
            vm.doReorder();
        }

        function sortDirectoryList(directoryList, sortName, sortReversed) {
            var sortMethodName = null;
            switch (sortName) {
                case 'name':
                    sortMethodName = 'sortByName';
                    break;
                case 'modified':
                    sortMethodName = 'sortByModificationDate';
                    break;
                case 'size':
                    sortMethodName = 'sortBySize';
                    break;
                case 'type':
                    sortMethodName = 'sortByType';
                    break;
                default:
                    break;
            }

            if (sortMethodName == null)
                return directoryList;

            return directorySortingFactory[sortMethodName](directoryList, sortReversed);
        }

        function directoryListSuccess(path, response, change) {
            $scope.directoryList = vm.sortDirectoryList(response.data.data, vm.sortName, vm.sortReversed);
            uiOperationFactory.currentDirectory = path;
            selectedItemsFactory.clearSelection();

            if (change) {
                if (!$scope.isHistoryChangeDir)
                    historyFactory.addEntry(uiOperationFactory.currentDirectory);
                $scope.isHistoryChangeDir = false;
                $rootScope.$broadcast('directory-changed', path);
                authenticationFactory.initialDirectory = path;
                authenticationFactory.saveSettings();
            }
            $timeout(function () {
                vm.setupContextMenuEvents();
                //DOM has finished rendering
            });
        }

        function changeDirectory(path, isFirstLoad, allowTimeout) {
            localConfigurationFactory.getApplicationSettings().then(
                function () {
                    var handleError;

                    if (allowTimeout) {
                        handleError = function () {
                            // this is on upload finish which might fail sometimes but we don't care
                        };
                    } else {
                        handleError = function (response) {
                            if (isFirstLoad)
                                connectionFactory.getDefaultPath().then(function (response) {
                                    vm.changeDirectory(response.data.data);
                                }, function () {
                                    showResponseError(response, 'DIRECTORY_CHANGE_OPERATION', $rootScope, $translate);
                                });
                            else
                                showResponseError(response, 'DIRECTORY_CHANGE_OPERATION', $rootScope, $translate);
                        };
                    }

                    connectionFactory.listDirectory(path, localConfigurationFactory.getConfigurationItem('showDotFiles')).then(
                        function (response) {
                            vm.directoryListSuccess(path, response, path != uiOperationFactory.currentDirectory);
                        },
                        handleError
                    );
                },
                function (response) {
                    showResponseError(response, 'APPLICATION_SETTINGS_LOAD_OPERATION', $rootScope, $translate);
                }
            );
        }

        function refreshDirectoryList() {
            vm.changeDirectory(uiOperationFactory.currentDirectory);
        }

        function filesReadyForDownloadCallback(response) {
            if (responseIsUnsuccessful(response)) {
                showResponseError(response, 'DOWNLOAD_OPERATION', $rootScope, $translate);
                return;
            }

            var fileKey = response.data.fileKey;
            $window.location = DOWNLOAD_PATH + '?fileKey=' + fileKey;
        }

        function fileFetchFailureCallback(response) {
            showResponseError(response, 'DOWNLOAD_OPERATION', $rootScope, $translate);
            $rootScope.$broadcast('modal-prompt:clear-busy');
        }

        function downloadFileAtPath(path) {
            connectionFactory.fetchFile(path).then(filesReadyForDownloadCallback, fileFetchFailureCallback);
        }

        function downloadMultiple() {
            var selectedItems = selectedItemsFactory.getSelectedItems();
            var itemNames = [];

            selectedItems.map(function (itemIndex) {
                itemNames.push($scope.directoryList[itemIndex].name);
            });

            connectionFactory.downloadMultipleFiles(uiOperationFactory.currentDirectory, itemNames).then(
                filesReadyForDownloadCallback, fileFetchFailureCallback);
        }

        function downloadSingle() {
            var fullFilePath = uiOperationFactory.joinNameToCurrentDirectory(
                $scope.directoryList[selectedItemsFactory.getSelectedItems()[0]].name);
            vm.downloadFileAtPath(fullFilePath);
        }

        function downloadSelectedFiles() {
            var selectedItems = selectedItemsFactory.getSelectedItems();
            if (selectedItems.length > 1 || $scope.directoryList[selectedItems[0]].isDirectory) {
                vm.downloadMultiple();
            } else {
                vm.downloadSingle();
            }
        }

        function getSelectedPaths() {
            var selectedPathCopy = selectedItemsFactory.getSelectedItems().slice();
            selectedPathCopy.sort(function (a, b) {
                return a - b;
            });
            return selectedPathCopy.map(function (pathIndex) {
                return uiOperationFactory.joinNameToCurrentDirectory($scope.directoryList[pathIndex].name);
            });
        }

        function initiateCopyOfPaths(paths) {
            if (paths.length == 0)
                return;

            uiOperationFactory.setCopySource(paths);
        }

        function initiateCutOfPaths(paths) {
            if (paths.length == 0)
                return;

            uiOperationFactory.setCutSource(paths);
        }

        function initiateCutOfSelectedPaths() {
            vm.initiateCutOfPaths(vm.getSelectedPaths());
        }

        function initiateCopyOfSelectedPaths() {
            vm.initiateCopyOfPaths(vm.getSelectedPaths());
        }

        function performPaste() {
            $translate('EXISTING_FILE_SUFFIX').then(function (translatedSuffix) {
                performPasteWithTranslatedCopyName(translatedSuffix);
            }, function () {
                performPasteWithTranslatedCopyName('Copy');
            });

        }

        function performPasteWithTranslatedCopyName(copySuffix) {
            if (uiOperationFactory.cutSource == null && uiOperationFactory.copySource == null)
                return;

            var sourcePaths, operation;

            if (uiOperationFactory.cutSource != null) {
                sourcePaths = uiOperationFactory.cutSource;
                operation = 'rename';
            } else {
                sourcePaths = uiOperationFactory.copySource;
                operation = 'copy';
            }

            for (var pathIndex = 0; pathIndex < sourcePaths.length; ++pathIndex) {
                var sourcePath = sourcePaths[pathIndex];

                if (isSubPath(sourcePath, uiOperationFactory.currentDirectory)) {
                    $rootScope.$broadcast('modal-error:show', "PASTE_TO_SUB_DIRECTORY_ERROR");
                    return;
                }

                var splitSourceFileName = sourcePath.split('/');
                var sourceFileName = getPasteName(splitSourceFileName[splitSourceFileName.length - 1], copySuffix);
                var destinationPath = uiOperationFactory.joinNameToCurrentDirectory(sourceFileName);
                connectionFactory[operation](sourcePath, destinationPath).then(function () {
                    uiOperationFactory.pasteComplete();
                    vm.changeDirectory(uiOperationFactory.currentDirectory);
                    if (operation == 'rename')
                        $rootScope.$broadcast('items-moved', [[sourcePath, destinationPath]]);
                }, function (response) {
                    showResponseError(response, 'FILE_PASTE_OPERATION', $rootScope, $translate);
                });
            }
        }

        function deleteComplete() {
            var allItems = [].concat($scope.directoriesToDelete || [], $scope.filesToDelete || []);

            $rootScope.$broadcast("items-deleted", allItems);

            $scope.directoriesToDelete = null;
            $scope.filesToDelete = null;
            vm.changeDirectory(uiOperationFactory.currentDirectory);
        }

        function confirmDelete() {
            var itemsToDelete = [];

            if ($scope.filesToDelete != null) {
                $scope.filesToDelete.map(function (path) {
                    if (uiOperationFactory.isCutOrCopySource(path))
                        uiOperationFactory.clearCutAndCopySource();

                    itemsToDelete.push([path, false]);
                });
            }

            if ($scope.directoriesToDelete != null) {
                $scope.directoriesToDelete.map(function (path) {
                    if (uiOperationFactory.isCutOrCopySource(path))
                        uiOperationFactory.clearCutAndCopySource();

                    itemsToDelete.push([path, true]);
                });
            }
            connectionFactory.deleteMultiple(itemsToDelete).then(function () {
                vm.deleteComplete();
            }, function (response) {
                showResponseError(response, 'DELETE_ITEM_OPERATION', $rootScope, $translate);
                vm.deleteComplete();
            });

            /*
             the inner function is needed for testing instead of calling connectionFactory.deleteFile directly in the map
             because the function is actually called with 3 args (item, index, arr) and the real function discards the
             second 2. the spy object doesn't know this so thinks its being called wrong
             */
        }

        function cancelDelete() {
            $scope.filesToDelete = null;
            $scope.directoriesToDelete = null;
        }

        function showTranslatedDeleteConfirm(translatedMessage) {
            $rootScope.$broadcast('modal-confirm:show', translatedMessage, vm.confirmDelete, vm.cancelDelete);
        }

        function showDeleteConfirm(fileNames) {
            $translate('DELETE_CONFIRM_MESSAGE', {
                item_count: fileNames.length
            }).then(function (translatedMessage) {
                showTranslatedDeleteConfirm(translatedMessage);
            }, function (message) {
                showTranslatedDeleteConfirm(message);
            });
        }

        function initiateDeleteOfSelectedPaths() {
            var selectedItems = selectedItemsFactory.getSelectedItems();
            if (selectedItems.length == 0)
                return;

            var fileNames = [];

            $scope.directoriesToDelete = [];
            $scope.filesToDelete = [];

            for (var i = 0; i < selectedItems.length; ++i) {
                var itemIndex = selectedItems[i];
                var item = $scope.directoryList[itemIndex];

                fileNames.push(item.name);

                var fullPath = uiOperationFactory.joinNameToCurrentDirectory(item.name);

                if (item.isDirectory)
                    $scope.directoriesToDelete.push(fullPath);
                else
                    $scope.filesToDelete.push(fullPath);
            }

            vm.showDeleteConfirm(fileNames);
        }

        function clearNewItemTempVars() {
            vm.newItemPath = null;
            $scope.makeItemType = null;
        }

        function makeItemSuccessCallback() {
            $rootScope.$broadcast('modal-prompt:hide');
            vm.refreshDirectoryList();

            if ($scope.makeItemType == FOLDER_TYPE) {
                clearNewItemTempVars();
                return;
            }

            localConfigurationFactory.getApplicationSettings().then(function () {
                var shouldEditItem = localConfigurationFactory.getConfigurationItem('editNewFilesImmediately');
                if (shouldEditItem && vm.itemIsEditable(false, vm.newItemPath)) {
                    var splitPath = vm.newItemPath.split('/');
                    $rootScope.$broadcast('file-editor:edit', splitPath[splitPath.length - 1], vm.newItemPath);
                }
                clearNewItemTempVars();
            }, function (response) {
                clearNewItemTempVars();
                showResponseError(response, 'RENAME_OPERATION', $rootScope, $translate);
            });
        }

        function makeItemFailureCallback(errorMessage, context) {
            $rootScope.$broadcast('modal-prompt:clear-busy');
            $translate(['NEW_ITEM_FAILURE_PRECEDING_MESSAGE', errorMessage], context).then(function (translations) {
                displayPromptError(translations['NEW_ITEM_FAILURE_PRECEDING_MESSAGE'] + ' ' +
                    translations[errorMessage])
            });
        }

        function getFileNameError(fileName) {
            if (!validateFileNameNonEmpty(fileName))
                return 'FILE_NAME_EMPTY_MESSAGE';

            if (!validateFileNameContainsNoSlash(fileName))
                return 'FILE_NAME_CONTAINS_SLASH_MESSAGE';

            return null;
        }

        function translateAndDisplayPromptError(promptErrorID, context) {
            $translate(promptErrorID, context).then(displayPromptError, displayPromptError);

        }

        function makeItemOKCallback(itemName) {
            $rootScope.$broadcast('modal-prompt:clear-error');

            var itemNameError = getFileNameError(itemName);

            if (itemNameError != null) {
                $translate($scope.makeItemType).then(function (translatedItemType) {
                    translateAndDisplayPromptError(itemNameError, {item_type: translatedItemType.toLowerCase()});
                }, function () {
                    translateAndDisplayPromptError(itemNameError, {item_type: $scope.makeItemType.toLowerCase()});
                });
                return;
            }

            vm.newItemPath = uiOperationFactory.joinNameToCurrentDirectory(itemName);

            $rootScope.$broadcast('modal-prompt:set-busy', 'CREATING_ACTIVITY_STATUS');

            var promise;
            if ($scope.makeItemType == FOLDER_TYPE)
                promise = connectionFactory.makeDirectory(vm.newItemPath);
            else if ($scope.makeItemType == FILE_TYPE)
                promise = connectionFactory.putFileContents(vm.newItemPath, '');

            promise.then(function () {
                vm.makeItemSuccessCallback();
            }, function (response) {
                var action = $scope.makeItemType.toUpperCase() + '_MAKE_OPERATION';

                var showTranslatedMakeItemFailure = function (translatedAction) {
                    vm.makeItemFailureCallback(parseErrorResponse(response, translatedAction), {
                        item_type: $scope.makeItemType,
                        action: translatedAction
                    });
                };

                $translate(action).then(function (translatedAction) {
                    showTranslatedMakeItemFailure(translatedAction);
                }, function () {
                    showTranslatedMakeItemFailure(action);
                });
            });
        }

        function initiateMakeItemWithTranslation(ucItemType) {
            $translate(['NEW_ITEM_PROMPT_TITLE', 'NEW_ITEM_NAME_PLACEHOLDER'], {item_type: ucItemType}).then(
                function (translations) {
                    $rootScope.$broadcast('modal-prompt:show', translations.NEW_ITEM_PROMPT_TITLE, '',
                        translations.NEW_ITEM_NAME_PLACEHOLDER, vm.makeItemOKCallback);
                });
        }

        function initiateMakeItem(itemType) {
            $scope.makeItemType = itemType;

            $translate(itemType).then(function (translatedItemType) {
                initiateMakeItemWithTranslation(translatedItemType);
            }, function () {
                var ucItemType = $scope.makeItemType.toLowerCase().capitalizeFirstLetter();

                initiateMakeItemWithTranslation(ucItemType);
            });
        }

        function initiateChmodOfItem(item) {
            var itemPaths = [uiOperationFactory.joinNameToCurrentDirectory(item.name)];

            $rootScope.$broadcast('modal-permissions:show', itemPaths, item.numericPermissions);
        }

        function initiateChmodOfSelectedItems() {
            if ($scope.selectedItems.length == 0)
                return;

            var itemPaths = [], numericPerms = -1;

            $scope.selectedItems.map(function (itemIndex) {
                var item = $scope.directoryList[itemIndex];
                itemPaths.push(uiOperationFactory.joinNameToCurrentDirectory(item.name));
                if (numericPerms == -1)
                    numericPerms = item.numericPermissions;
                else if (item.numericPermissions != numericPerms)
                    numericPerms = 0;
            });

            $rootScope.$broadcast('modal-permissions:show', itemPaths, numericPerms);
        }

        function displayPromptError(error) {
            $rootScope.$broadcast('modal-prompt:set-error', error);
        }

        function fileRenameCallback(finalValue, initialValue) {
            $rootScope.$broadcast('modal-prompt:clear-error');

            if (initialValue == finalValue)
                return;

            var itemNameError = getFileNameError(finalValue);

            if (itemNameError != null) {
                translateAndDisplayPromptError(itemNameError, {item_type: 'item'});
                return;
            }

            $rootScope.$broadcast('modal-prompt:set-busy', 'RENAMING_ACTIVITY_STATUS');

            var sourcePath = uiOperationFactory.joinNameToCurrentDirectory(initialValue);
            var destinationPath = uiOperationFactory.joinNameToCurrentDirectory(finalValue);
            connectionFactory.rename(sourcePath, destinationPath).then(
                function (response) {
                    $rootScope.$broadcast('modal-prompt:clear-busy');
                    if (responseIsUnsuccessful(response)) {
                        showResponseError(response, 'RENAME_OPERATION', $rootScope, $translate);
                        return;
                    }
                    vm.refreshDirectoryList();
                    $rootScope.$broadcast('items-moved', [[sourcePath, destinationPath]]);
                    $rootScope.$broadcast('modal-prompt:hide');
                },
                function (response) {
                    $rootScope.$broadcast('modal-prompt:clear-busy');
                    showResponseError(response, 'RENAME_OPERATION', $rootScope, $translate);
                }
            );
            vm.renameSource = null;
        }

        function showRenamePrompt(translations) {
            $rootScope.$broadcast('modal-prompt:show', translations.RENAME_FILE_PROMPT_TITLE, vm.renameSource,
                translations.RENAME_FILE_NAME_PLACEHOLDER, vm.fileRenameCallback);
        }

        function initiateRename() {
            $translate(['RENAME_FILE_PROMPT_TITLE', 'RENAME_FILE_NAME_PLACEHOLDER']).then(showRenamePrompt,
                showRenamePrompt);
        }

        function handleChangeDirectory(path, allowTimeout) {
            if (path == uiOperationFactory.currentDirectory)
                return;
            if (typeof path == 'undefined' || path == null)
                path = uiOperationFactory.currentDirectory;
            vm.changeDirectory(path, false, allowTimeout);
        }

        function didLogout() {
            uiOperationFactory.currentDirectory = null;
            authenticationFactory.initialDirectory = null;
            $scope.directoryList = [];
            historyFactory.clearHistory();
        }

        function systemVarLoadSuccess(vars) {
            vm.systemVars = vars;
            vm.setEditableExtensions(configurationFactory.getApplicationSetting('editableFileExtensions'));

            if (licenseFactory.isLicensed()) {
                vm.allowFileCreation = true;
                vm.enableChmod = vm.enableChmod && !configurationFactory.getApplicationSetting('disableChmod');
                vm.enableFileView = !configurationFactory.getApplicationSetting('disableFileView');
                vm.enableFileEdit = vm.enableFileView && !configurationFactory.getApplicationSetting('disableFileEdit');
                vm.contextMenuItemDisplay = configurationFactory.getApplicationSetting('contextMenuItemDisplay') || {};
                vm.browserColumnDisplay = configurationFactory.getApplicationSetting('fileBrowserColumnDisplay') || {};
                vm.archiveUploadAllowed = true;
            } else {
                vm.allowFileCreation = false;
                vm.archiveUploadAllowed = false;
            }

            postLogin();
        }

        function systemVarLoadFailure(response) {
            showResponseError(response, "SYSTEM_VAR_LOAD_OPERATION", $rootScope, $translate);
        }

        function setEditableExtensions(editableExtensionStr) {
            var splitExtensions = editableExtensionStr.split(",");
            editableExtensions = [];
            for (var i = 0; i < splitExtensions.length; ++i) {
                var trimmedExtension = splitExtensions[i].trim().toLowerCase();

                if (trimmedExtension == "*") {
                    editableExtensions = [];
                    return;
                }

                if (trimmedExtension != '')
                    editableExtensions.push(trimmedExtension);
            }
        }

        function itemIsEditable(isDirectory, itemPath) {
            if (!licenseFactory.isLicensed())
                return false;

            if (isDirectory)
                return false;

            if (editableExtensions.length === 0)
                return true;

            var splitPath = itemPath.split('/');
            var itemName = splitPath[splitPath.length - 1];
            var extension = extractFileExtension(itemName);

            if (extension == '')
                return true;

            return editableExtensions.indexOf(extension) !== -1;
        }

        function navigateUpOneLevel() {
            vm.changeDirectory(parentPath(uiOperationFactory.currentDirectory), false);
        }

        function showProperties(item) {
            $rootScope.$broadcast('modal-properties:show', item);
        }

        function handleBodyClick($event) {
            if ($event.which == 3 && $event.target.id == "files") { // right click
                $scope.hasPasteSource = uiOperationFactory.cutSource != null || uiOperationFactory.copySource != null;

                if (currentContextMenu)
                    currentContextMenu.dropdown('toggle');

                var $extraDropdownButton = jQuery('#extras-dropdown-button');

                $extraDropdownButton.dropdown('toggle');
                var $dropdownMenu = jQuery('#extras-dropdown');
                $dropdownMenu.css(contextMenuStyleForEvent($event));

                fixContextMenuOffScreen($event, $dropdownMenu);

                return false;
            }
        }

        function rowMouseDown($event) {
            rowMouseTrackerFactory.mouseDown($event);
        }

        function rowMouseMove($event, $index) {
            rowMouseTrackerFactory.mouseMove($event, $index);
        }

        function rowMouseUp($index) {
            rowMouseTrackerFactory.mouseUp($index, preventRowDeselect);
            preventRowDeselect = false;
        }

        function rowMouseLeave($event) {
            rowMouseTrackerFactory.mouseLeave($event);
        }

        function fileNameInDirectoryList(fileName) {
            for (var itemIndex = 0; itemIndex < $scope.directoryList.length; ++itemIndex)
                if ($scope.directoryList[itemIndex].name == fileName)
                    return true;

            return false;
        }

        function getPasteName(fileName, duplicateSuffix) {
            var proposedFileName = fileName;

            if (!fileNameInDirectoryList(proposedFileName))
                return proposedFileName;

            var fileAndExtension = splitFileExtension(proposedFileName);

            proposedFileName = fileAndExtension[0] + " - " + duplicateSuffix + fileAndExtension[1];

            if (!fileNameInDirectoryList(proposedFileName))
                return proposedFileName;

            for (var i = 2; ; ++i) {
                var fileWithNumber = fileAndExtension[0] + " - " + duplicateSuffix + " " + i + fileAndExtension[1];
                if (!fileNameInDirectoryList(fileWithNumber))
                    return fileWithNumber;
            }
        }

        function objectKeyIsFalse(theObject, key) {
            if (!theObject.hasOwnProperty(key))
                return false;

            return theObject[key] === false;
        }

        function contextMenuItemHidden(itemId) {
            return objectKeyIsFalse(vm.contextMenuItemDisplay, itemId);
        }

        function browserColumnHidden(columnId) {
            return objectKeyIsFalse(vm.browserColumnDisplay, columnId);
        }

        function initiateArchiveExtract(item) {
            if (!vm.archiveUploadAllowed)
                return;

            var remotePath = uiOperationFactory.joinNameToCurrentDirectory(item.name);

            connectionFactory.downloadForExtract(remotePath).then(
                function (response) {
                    uploadFactory.addExtract(item.name, response.data.data.fileKey, response.data.data.fileCount);
                }, function (response) {
                    showResponseError(response, "DOWNLOAD_FOR_EXTRACT_OPERATION", $rootScope, $translate);
                });
        }

        function shouldHideContextMenu() {
            if (isShouldHideContextMenu === null) {
                isShouldHideContextMenu = allInterfaceOptionsDisabled(allContextMenuItems, vm.contextMenuItemDisplay);
            }

            return isShouldHideContextMenu;
        }
    }
}());
(function(){
    angular.module('MonstaFTP').directive('monstaReorder', monstaReorder);

    function monstaReorder() {
        return {
            replace: true,
            scope: {
                sortIdentifier: "&",
                sortName: "&",
                vm: "="
            },
            template: '<span ng-click="vm.handleReorderChange(sortIdentifier)" data-sort-dir="">' +
                        '{{ sortName|translate }}' +
                            '<i ng-show="vm.sortName == sortIdentifier" class="fa" ' +
                                'ng-class="{\'fa-caret-up\': !vm.sortReversed, \'fa-caret-down\': vm.sortReversed}" ' +
                                'aria-hidden="true"></i></span>',
            restrict: 'E',
            link: function ($scope, element, attrs) {
                $scope.sortName = attrs.sortName;
                $scope.sortIdentifier = attrs.sortIdentifier;
            }
        }
    }
}());
(function(){
    angular.module('MonstaFTP').directive('monstaReorderMobile', monstaReorderMobile);

    function monstaReorderMobile() {
        return {
            replace: true,
            scope: {
                sortIdentifier: "&",
                sortName: "&",
                vm: "="
            },
            template: '<li><a href="#" ng-click="vm.handleReorderChange(sortIdentifier)" data-sort-dir="" translate>{{ sortName }}</a></li>',
            restrict: 'E',
            link: function ($scope, element, attrs) {
                $scope.sortName = attrs.sortName;
                $scope.sortIdentifier = attrs.sortIdentifier;
            }
        }
    }
}());
(function () {
    angular.module('MonstaFTP').factory('rowMouseTrackerFactory', rowMouseTrackerFactory);

    rowMouseTrackerFactory.$inject = ['selectedItemsFactory'];

    function rowMouseTrackerFactory(selectedItemsFactory) {
        var factory = {}, mouseIsDown = false, mouseMovedWhileDown = false, mouseDownEvent,
            rowClickTargetElementNames = ['DIV', 'TR', 'TD', 'SPAN'], rowDragStartIndex = null, isMetaDrag = false;

        factory.mouseDown = mouseDown;
        factory.mouseUp = mouseUp;
        factory.mouseMove = mouseMove;
        factory.mouseLeave = mouseLeave;

        factory.mouseClick = mouseClick;
        factory.mouseDrag = mouseDrag;
        factory.startDrag = startDrag;

        function mouseDown($event) {
            mouseIsDown = true;
            mouseDownEvent = $event;
            mouseMovedWhileDown = false;
        }

        function mouseUp(rowIndex, preventRowDeselect) {
            if (mouseIsDown && !mouseMovedWhileDown && !preventRowDeselect) {
                factory.mouseClick(mouseDownEvent, rowIndex);
            }
            mouseIsDown = false;
            rowDragStartIndex = null;
        }

        function mouseMove($event, rowIndex) {
            if (mouseIsDown) {
                mouseMovedWhileDown = true;
                if (rowDragStartIndex == rowIndex)
                    return;

                if (rowDragStartIndex == null)
                    factory.startDrag($event, rowIndex);
                else
                    factory.mouseDrag(rowIndex);

                rowDragStartIndex = rowIndex;
            }
        }

        function mouseLeave($event) {
            if (rowClickTargetElementNames.indexOf($event.target.tagName) != -1)
                return true;

            rowDragStartIndex = null;
        }

        function mouseDrag(rowIndex) {
            if (isMetaDrag)
                selectedItemsFactory.metaDraggedToIndex(rowIndex);
            else
                selectedItemsFactory.draggedToIndex(rowIndex);
        }

        function mouseClick($event, itemIndex) {
            if (rowClickTargetElementNames.indexOf($event.target.tagName) == -1)
                return true;
            $event.preventDefault();
            if ($event.ctrlKey || $event.metaKey)
                selectedItemsFactory.metaClickAtIndex(itemIndex);
            else if ($event.shiftKey)
                selectedItemsFactory.shiftClickAtIndex(itemIndex);
            else if ($event.target.tagName != "SPAN")
                selectedItemsFactory.standardClickAtIndex(itemIndex);
        }

        function startDrag($event, rowIndex) {
            if ($event.metaKey || $event.ctrlKey) {
                isMetaDrag = true;
                selectedItemsFactory.startMetaDraggingAtIndex(rowIndex);
            } else {
                isMetaDrag = false;
                selectedItemsFactory.startDraggingAtIndex(rowIndex);
            }
        }

        return factory;
    }
}());
(function () {
    angular.module('MonstaFTP').factory('selectedItemsFactory', selectedItemsFactory);

    selectedItemsFactory.$inject = ['$rootScope'];

    function selectedItemsFactory($rootScope) {
        var selectedItems = [];
        var initialSelectedIndex = 0;
        var dragStartIndex = 0;
        var metaDragStartIndex = 0;
        var metaSelectedItems;

        var factory = {
            getSelectedItems: getSelectedItems,
            standardClickAtIndex: standardClickAtIndex,
            shiftClickAtIndex: shiftClickAtIndex,
            metaClickAtIndex: metaClickAtIndex,
            clearSelection: clearSelection,
            startDraggingAtIndex: startDraggingAtIndex,
            draggedToIndex: draggedToIndex,
            startMetaDraggingAtIndex: startMetaDraggingAtIndex,
            metaDraggedToIndex: metaDraggedToIndex,
            selectItem: selectItem
        };

        function generateRange(start, stop) {
            if (start == stop)
                return [start];

            var delta = 1;

            if (start > stop)
                delta = -1;

            var range = [start];

            do {
                start += delta;
                range.push(start);
            } while(start != stop);

            return range;
        }

        function getSelectedItems() {
            return selectedItems;
        }

        function standardClickAtIndex(index) {
            if(selectedItems.length == 1 && selectedItems[0] == index) {
                selectedItems = [];
                broadcastSelectionChange();
                return;
            }

            if(selectedItems.indexOf(index) == -1 || selectedItems.length > 1) {
                // this is just for speed, we could do the below all the time but will be a little fast to skip it
                // unless it's actually necessary
                selectedItems = [index];
                initialSelectedIndex = index;
                broadcastSelectionChange();
            }
        }

        function shiftClickAtIndex(index) {
            if(selectedItems.length != 1 || selectedItems.indexOf(index) == -1) {
                selectedItems = generateRange(initialSelectedIndex, index);
                broadcastSelectionChange();
            }
        }

        function metaClickAtIndex(index) {
            var indexOfIndex = selectedItems.indexOf(index);

            if(indexOfIndex == -1)
                selectedItems.push(index);
            else
                selectedItems.splice(indexOfIndex, 1);
            broadcastSelectionChange();
        }

        function clearSelection() {
            selectedItems = [];
            broadcastSelectionChange();
        }

        function startDraggingAtIndex(index) {
            clearSelection();
            dragStartIndex = index;
            selectedItems = [index];
            broadcastSelectionChange();
        }

        function draggedToIndex(index) {
            selectedItems = generateRange(dragStartIndex, index);
            broadcastSelectionChange();
        }

        function startMetaDraggingAtIndex(index){
            metaDragStartIndex = index;
            metaSelectedItems = angular.copy(selectedItems);
        }

        function metaDraggedToIndex(index) {
            var newSelectedItems = angular.copy(metaSelectedItems),
                lowerBound = Math.min(index, metaDragStartIndex),
                upperBound = Math.max(index, metaDragStartIndex);

            for(; lowerBound <= upperBound; ++lowerBound){
                var indexOfIndex = metaSelectedItems.indexOf(lowerBound);

                if(indexOfIndex == -1)
                    newSelectedItems.push(lowerBound);
                else
                    newSelectedItems.splice(newSelectedItems.indexOf(lowerBound), 1);
            }

            selectedItems = newSelectedItems;
            broadcastSelectionChange();
        }

        function selectItem(index) {
            selectedItems = [index];
            broadcastSelectionChange();
        }

        function broadcastSelectionChange() {
            $rootScope.$broadcast('selected-items-changed');
        }

        return factory;
    }
}());



function TransferStats(totalItems) {
    this.completedItems = -1;
    this.previousCompletedItems = -1;
    this.totalItems = totalItems;
    this.previousSampleTime = -1;
    this._transferRateSamples = [];
    this.transferType = "";
}

TransferStats.prototype.wasStarted = function () {
    this.previousSampleTime = Date.now();
    this.completedItems = 0;
    this.previousCompletedItems = 0;
};

TransferStats.prototype.updateTransferAmount = function (completedItems) {
    var transferComplete = completedItems === this.totalItems;

    if (!transferComplete && Date.now() - this.previousSampleTime < TRANSFER_RATE_UPDATE_INTERVAL)
        return false;

    if (completedItems < this.completedItems)
        return false;

    if (!transferComplete && (completedItems - this.completedItems <= TRANSFER_ITEMS_MIN_UPDATE))
        return false; // limit update rate

    this.previousCompletedItems = this.completedItems;
    this.completedItems = completedItems;
    this.addTransferRate();
    return true;
};

TransferStats.prototype.addTransferRate = function () {
    if (this._transferRateSamples.length == TRANSFER_RATE_SAMPLES_MAX)
        this._transferRateSamples.splice(0, 1);

    this._transferRateSamples.push(this.getInstantaneousTransferRate());
};

TransferStats.prototype.calculateTransferRate = function () {
    if (this._transferRateSamples.length == 0)
        return 0;

    var sum = 0;

    this._transferRateSamples.map(function (rate) {
        sum += rate;
    });

    return sum / this._transferRateSamples.length;
};

TransferStats.prototype.getInstantaneousTransferRate = function () {
    var elapsedTime = Date.now() - this.previousSampleTime;
    this.previousSampleTime = Date.now();
    return (this.completedItems - this.previousCompletedItems) / (elapsedTime / 1000);
};

TransferStats.prototype.getTransferPercent = function () {
    if (this.totalItems == 0 || this.totalItems == null || this.completedItems == null)
        return 0;

    return (100 * this.completedItems) / this.totalItems;
};

TransferStats.prototype.complete = function () {
    this.completedItems = this.totalItems;
};

TransferStats.prototype.hasBeenStarted = function () {
    return this.previousSampleTime != -1;
};
(function () {
    angular.module('MonstaFTP').controller('FileEditorController', FileEditorController);

    FileEditorController.$inject = ['$scope', '$rootScope', 'connectionFactory', 'jQuery', 'licenseFactory',
        'codeMirrorFactory', '$translate', 'uiOperationFactory', 'configurationFactory'];

    function FileEditorController($scope, $rootScope, connectionFactory, jQuery, licenseFactory, codeMirrorFactory,
                                  $translate, uiOperationFactory, configurationFactory) {
        'use strict';
        $scope.editorFiles = [];
        $scope.activeFile = null;
        $scope.pathOfTabToRemove = null;
        $scope.licenseFactory = licenseFactory;
        $scope.settings = {autoSave: false};

        var modalFileEditorId = '#modal-editor', vm = this, autoSaveTimeout = null, $filePickerMenu = null,
            addMenuListener, menuCloseClickSetup = false;

        vm.savedDirectories = [];
        vm.hideProUpgradeMessages = false;
        vm.allowEdit = true;

        vm.show = show;
        vm.hide = hide;
        vm.setupAdvancedEditor = setupAdvancedEditor;
        vm.startEditingFile = startEditingFile;
        vm.ensureFileInScope = ensureFileInScope;
        vm.getFileIndexByPath = getFileIndexByPath;
        vm.filePathIsInScope = filePathIsInScope;
        vm.getEditorFileByPath = getEditorFileByPath;
        vm.updateFileContents = updateFileContents;
        vm.loadFileContents = loadFileContents;
        vm.removeFile = removeFile;
        vm.initiateConfirmTabClose = initiateConfirmTabClose;
        vm.confirmTabClose = confirmTabClose;
        vm.cancelTabClose = cancelTabClose;
        vm.contentPutFinish = contentPutFinish;
        vm.beginAutoSave = beginAutoSave;
        vm.fileListClick = fileListClick;
        vm.shouldShowProUpgrade = shouldShowProUpgrade;
        vm.itemsMoved = itemsMoved;

        $scope.activateTab = function (filePath, $event) {
            if ($event.target.tagName == 'BUTTON')
                return;

            $scope.activeFile = vm.getEditorFileByPath(filePath);

            if ($filePickerMenu != null)
                $filePickerMenu.removeClass('open');

            if (menuCloseClickSetup)
                removeMenuCloseListener();
        };

        $scope.closeTabForFile = function (fileName, filePath) {
            var file = vm.getEditorFileByPath(filePath);
            if (!file.dirty) {
                vm.removeFile(filePath);
                return false;
            }

            vm.initiateConfirmTabClose(fileName, filePath);
            return false;
        };

        $scope.textChange = function (filePath) {
            var file = vm.getEditorFileByPath(filePath);
            if (file == null)
                return;

            var oldDirty = file.dirty; // rip

            file.dirty = file.contents !== file.cm.getValue();

            if (file.dirty !== oldDirty) { // only update UI if dirty status has changed. shimmy shimmy ya
                window.setTimeout(function () {
                    $scope.$apply();
                });
            }

            vm.beginAutoSave.call(vm);
        };

        $scope.saveActiveFile = function (ignoreStatusIndicator) {
            if ($scope.activeFile == null)
                return;

            if (!$scope.activeFile.dirty)
                return;

            $scope.activeFile.saving = true;
            $scope.activeFile.contents = $scope.activeFile.cm.getValue();
            var path = $scope.activeFile.path;
            var encodeSave = configurationFactory.getApplicationSetting('encodeEditorSaves');

            connectionFactory.putFileContents(path, $scope.activeFile.contents, ignoreStatusIndicator, encodeSave).then(function () {
                vm.contentPutFinish(path, true);
            }, function (response) {
                vm.contentPutFinish(path, false);
                showResponseError(response, 'FILE_SAVE_OPERATION', $rootScope, $translate);
            });
        };

        $scope.$on('file-editor:edit', function (ev, fileName, filePath) {
            if (licenseFactory.isLicensed()) {
                vm.allowEdit = !configurationFactory.getApplicationSetting('disableFileEdit');
                codeMirrorFactory.readOnly = configurationFactory.getApplicationSetting('disableFileEdit');
            }

            vm.startEditingFile(fileName, filePath);
            vm.show();
        });

        $scope.$on('file-editor:show', function () {
            vm.show();
        });

        function clearFiles() {
            $scope.editorFiles = [];
            $scope.activeFile = null;
        }

        $scope.$on('logout', function () {
            clearFiles();
        });

        $scope.$on('login', function () {
            clearFiles();
        });

        $scope.$on('items-deleted', function (ev, deletedItems) {
            vm.itemsMoved(deletedItems);
        });

        $scope.$on('items-moved', function (ev, movedItems) {
            var moveSources = [];

            for (var i = 0; i < movedItems.length; ++i)
                moveSources.push(movedItems[i][0])

            vm.itemsMoved(moveSources);
        });

        function show() {
            $rootScope.$broadcast('file-editor:will-show');
            vm.hideProUpgradeMessages = configurationFactory.getApplicationSetting('hideProUpgradeMessages');
            vm.savedDirectories = [];
            jQuery(modalFileEditorId).modal('show');
        }

        function hide() {
            if (menuCloseClickSetup)
                removeMenuCloseListener();

            if (vm.savedDirectories.indexOf(uiOperationFactory.currentDirectory) != -1)
                $rootScope.$broadcast('change-directory'); // refresh directory list if there was a save in current dir

            if ($filePickerMenu != null)
                $filePickerMenu.removeClass('open');

            $rootScope.$broadcast('file-editor:hide', $scope.editorFiles.length);
            jQuery(modalFileEditorId).modal('hide');
        }

        function setupAdvancedEditor(fileName, filePath) {
            var codeMode = codeMirrorFactory.convertFilenameToMode(fileName);
            window.setTimeout(function () {
                var editorItem = vm.getEditorFileByPath(filePath);

                if (editorItem == null)
                    return;

                if (editorItem.cmSetup == true) {
                    if (!editorItem.dirty) {
                        editorItem.cm.setValue(editorItem.contents);
                    }
                    return;
                }

                var textAreaId = "editor_ta_" + filePath;
                codeMirrorFactory.initiateCodeMirror(codeMode, document.getElementById(textAreaId), function (cm) {
                    editorItem.cmSetup = true;
                    editorItem.cm = cm;
                    cm.on('change', function () {
                        $scope.textChange(editorItem.path);
                    });
                });
            }, 0);
        }

        function startEditingFile(fileName, filePath) {
            if (!licenseFactory.isLicensed())
                return;

            vm.ensureFileInScope(fileName, filePath, true, function () {
                $scope.activeFile = vm.getEditorFileByPath(filePath);
                vm.setupAdvancedEditor(fileName, filePath);
            });
        }

        function ensureFileInScope(fileName, filePath, reloadContents, contentsLoadedCallback) {
            if (vm.filePathIsInScope(filePath)) {
                var existingEditorFile = vm.getEditorFileByPath(filePath);

                if (existingEditorFile.dirty || !reloadContents) {
                    if (contentsLoadedCallback)
                        contentsLoadedCallback();
                    return true;
                }

                vm.loadFileContents(filePath, contentsLoadedCallback);
                return false;
            }

            var editorFile = {
                name: fileName,
                path: filePath,
                contents: null,
                dirty: false,
                saving: false,
                cmSetup: false,
                cm: null
            };

            if (licenseFactory.isLicensed()) {
                $scope.editorFiles.push(editorFile);
                $scope.editorFiles.sort(function (a, b) {
                    return a.path.toLowerCase() < b.path.toLowerCase() ? -1 : 1;
                });
            } else
                $scope.editorFiles = [editorFile];

            vm.loadFileContents(filePath, contentsLoadedCallback);
            return false;
        }

        function getFileIndexByPath(filePath) {
            for (var fileIndex = 0; fileIndex < $scope.editorFiles.length; ++fileIndex)
                if ($scope.editorFiles[fileIndex].path == filePath)
                    return fileIndex;

            return null;
        }

        function filePathIsInScope(filePath) {
            return vm.getFileIndexByPath(filePath) != null;
        }

        function getEditorFileByPath(filePath) {
            var fileIndex = vm.getFileIndexByPath(filePath);
            return fileIndex == null ? null : $scope.editorFiles[fileIndex];
        }

        function updateFileContents(filePath, fileContents) {
            var file = vm.getEditorFileByPath(filePath);
            if (file == null)
                return;
            file.contents = fileContents;
        }

        function loadFileContents(filePath, contentsLoadedCallback) {
            var file = vm.getEditorFileByPath(filePath);
            if (file == null)
                return;

            connectionFactory.getFileContents(filePath).then(
                function (response) {
                    vm.updateFileContents(filePath, b64DecodeUnicode(response.data.data));
                    if (contentsLoadedCallback)
                        contentsLoadedCallback();
                }, function (response) {
                    showResponseError(response, 'FILE_LOAD_OPERATION', $rootScope, $translate);
                });
        }

        function removeFile(filePath) {
            var fileIndex = vm.getFileIndexByPath(filePath);
            if (fileIndex == null)
                return;

            var closingFiles = $scope.editorFiles.splice(fileIndex, 1);

            if (closingFiles.length && closingFiles[0].cm) {
                closingFiles[0].cm.toTextArea();
                closingFiles[0].cm = null;
            }

            if ($scope.editorFiles.length == 0) {
                $scope.activeFile = null;
                vm.hide();
                return;
            }

            var newFileIndex = Math.min(fileIndex, $scope.editorFiles.length - 1);
            $scope.activeFile = $scope.editorFiles[newFileIndex];
        }

        function showTabCloseConfirm(confirmMessage) {
            $rootScope.$broadcast('modal-confirm:show', confirmMessage, vm.confirmTabClose, vm.cancelTabClose);
        }

        function initiateConfirmTabClose(fileName, filePath) {
            $scope.pathOfTabToRemove = filePath;
            $translate('EDITOR_CLOSE_CONFIRM_MESSAGE', {file_name: fileName}).then(showTabCloseConfirm,
                showTabCloseConfirm);
        }

        function confirmTabClose() {
            vm.removeFile($scope.pathOfTabToRemove);
            $scope.pathOfTabToRemove = null;
        }

        function cancelTabClose() {
            $scope.pathOfTabToRemove = null;
        }

        function contentPutFinish(filePath, success) {
            var file = vm.getEditorFileByPath(filePath);
            if (file == null)
                return;

            file.saving = false;
            if (success) {
                file.dirty = false;
                var dirName = filePath.replace(/\\/g, '/').replace(/\/[^\/]*\/?$/, '');
                if (dirName == '')
                    dirName = '/';
                if (vm.savedDirectories.indexOf(dirName) == -1)
                    vm.savedDirectories.push(dirName);
            }
        }

        function beginAutoSave() {
            if (autoSaveTimeout)
                window.clearTimeout(autoSaveTimeout);

            if (!$scope.settings.autoSave || !vm.allowEdit)
                return;

            autoSaveTimeout = window.setTimeout(function () {
                autoSaveTimeout = null;
                $scope.saveActiveFile(true);
            }, AUTOSAVE_DELAY_MS);
        }

        function windowClickOnOpenMenuHandler(event) {
            if ($filePickerMenu == null || !$filePickerMenu.hasClass('open') ||
                event.target.classList.contains("close"))
                return;

            $filePickerMenu.removeClass('open');
            removeMenuCloseListener();
        }

        function addMenuCloseListener() {
            window.addEventListener('click', windowClickOnOpenMenuHandler);
            menuCloseClickSetup = true;
        }

        function removeMenuCloseListener() {
            window.removeEventListener('click', windowClickOnOpenMenuHandler);
            menuCloseClickSetup = false;
        }

        function fileListClick($event) {
            if ($filePickerMenu == null) {
                $filePickerMenu = jQuery($event.target).parent();

                if ($event.target.tagName == "I")
                    $filePickerMenu = $filePickerMenu.parent();
            }

            addMenuListener = !$filePickerMenu.hasClass('open');

            $event.preventDefault();

            $filePickerMenu.toggleClass('open');

            window.setTimeout(function () {
                if (addMenuListener)
                    addMenuCloseListener();
                else
                    removeMenuCloseListener();
            }, 0);

            return false;
        }

        function shouldShowProUpgrade() {
            if (vm.hideProUpgradeMessages === true)
                return false;

            return !licenseFactory.isLicensed();
        }

        function itemsMoved(deletedItems) {
            // this really means the item is no longer where we expected it (moved, renamed or deleted)
            var pathsToRemove = [];
            for (var deletedPathIndex = 0; deletedPathIndex < deletedItems.length; ++deletedPathIndex) {
                var deletedPath = deletedItems[deletedPathIndex];

                if (deletedPath.length == 0)
                    continue;

                var deletedPathAsDirectory = deletedPath.substr(deletedPath.length - 1) == "/" ? deletedPath : (deletedPath + "/");

                for (var editorFileIndex = 0; editorFileIndex < $scope.editorFiles.length; ++editorFileIndex) {
                    var editorFile = $scope.editorFiles[editorFileIndex];
                    if (deletedPath == editorFile.path)
                        pathsToRemove.push(editorFile.path);
                    else {
                        if (editorFile.path.length <= deletedPathAsDirectory.length)
                            continue;

                        if (editorFile.path.substr(0, deletedPathAsDirectory.length) == deletedPathAsDirectory)
                            pathsToRemove.push(editorFile.path);
                    }

                }
            }

            for (var removeIndex = 0; removeIndex < pathsToRemove.length; ++removeIndex) {
                vm.removeFile(pathsToRemove[removeIndex], true);
            }
        }
    }
}());
(function () {
    angular.module('MonstaFTP').controller('HeaderController', HeaderController);

    HeaderController.$inject = ['$scope', '$rootScope', 'historyFactory', 'licenseFactory', 'configurationFactory'];

    function HeaderController($scope, $rootScope, historyFactory, licenseFactory, configurationFactory) {
        var vm = this, allHeaderItems = ["forward", "back", "refresh"];

        vm.canGoBack = false;
        vm.canGoForward = false;
        vm.itemDisplay = {};

        vm.navigateBack = navigateBack;
        vm.navigateForward = navigateForward;
        vm.refresh = refresh;
        vm.itemHidden = itemHidden;

        $scope.$on('history-changed', function () {
            updateScopeFromHistoryFactory();
        });

        $scope.$on('directory-changed', function () {
            updateScopeFromHistoryFactory();
        });

        $scope.$on('license-loaded', function () {
            if (licenseFactory.isLicensed()) {
                configurationFactory.getSystemConfiguration().then(function () {
                    vm.itemDisplay = configurationFactory.getApplicationSetting('headerItemDisplay') || {};
                    updateHeaderDisplay();
                }, function () {
                });
            }
        });

        function updateScopeFromHistoryFactory() {
            vm.canGoBack = historyFactory.hasPreviousHistoryItem();
            vm.canGoForward = historyFactory.hasNextHistoryItem();
        }

        function itemHidden(itemId) {
            if (!vm.itemDisplay.hasOwnProperty(itemId))
                return false;

            return vm.itemDisplay[itemId] === false;
        }

        function navigateBack() {
            if (!vm.canGoBack)
                return;

            var newDir = historyFactory.navigateBack();

            if (newDir)
                $rootScope.$broadcast('change-directory:on-history', newDir);
        }

        function navigateForward() {
            if (!vm.canGoForward)
                return;

            var newDir = historyFactory.navigateForward();

            if (newDir)
                $rootScope.$broadcast('change-directory:on-history', newDir);
        }

        function refresh() {
            $rootScope.$broadcast('change-directory');
        }

        function updateHeaderDisplay() {
            if (allInterfaceOptionsDisabled(allHeaderItems, vm.itemDisplay)) {
                var body = document.getElementsByTagName('body')[0];
                body.classList.add('no-header');
            }
        }
    }
}());

(function () {
    angular.module('MonstaFTP').controller('FooterController', FooterController);

    FooterController.$inject = ['$scope', '$rootScope', 'uiOperationFactory', 'connectionFactory',
        'authenticationFactory', 'uploadUIFactory', '$translate', 'selectedItemsFactory', 'configurationFactory',
        'licenseFactory'];

    function FooterController($scope, $rootScope, uiOperationFactory, connectionFactory,
                              authenticationFactory, uploadUIFactory, $translate, selectedItemsFactory,
                              configurationFactory, licenseFactory) {
        var vm = this, actionsRequiringSelection = ['chmod', 'cut', 'copy', 'download'], folderUploadSupported = null,
            allFooterItems = [
                "chmod",
                "cut",
                "copy",
                "paste",
                "delete",
                "fetch-file",
                "upload",
                "upload-file",
                "upload-folder",
                "upload-archive",
                "download",
                "new-item",
                "new-file",
                "new-folder",
                "show-editor",
                "session-information",
                "remote-server",
                "username",
                "upload-limit",
                "version",
                "new-version-alert"
            ];
        vm.isArchiveUpload = false;

        $scope.selectedItemsCount = 0;
        $scope.hasPasteSource = false;
        $scope.maxUploadBytes = MAX_UPLOAD_BYTES;
        $scope.currentUsername = null;
        $scope.currentHost = null;
        $scope.currentVersion = 0;
        $scope.newVersionAvailable = false;
        $scope.editorActive = false;

        vm.enableChmod = true;
        vm.enableFileView = licenseFactory.isLicensed();
        vm.enableFileEdit = licenseFactory.isLicensed();
        vm.showRemoteServerAddress = true;
        vm.isLicensed = false;
        vm.isLoggedIn = false;
        vm.archiveUploadAllowed = licenseFactory.isLicensed();
        vm.itemDisplay = {};

        vm.handleUpload = handleUpload;
        vm.handleUploadFolder = handleUploadFolder;
        vm.allowAction = allowAction;
        vm.performRemoteFetch = performRemoteFetch;
        vm.remoteFetchCallback = remoteFetchCallback;
        vm.initiateRemoteFetch = initiateRemoteFetch;
        vm.onEditorHide = onEditorHide;
        vm.showEditor = showEditor;
        vm.validateArchiveUpload = validateArchiveUpload;
        vm.buttonClick = buttonClick;
        vm.itemHidden = itemHidden;

        var uploadSingleInput = document.getElementById('upload-placeholder'),
            uploadFolderInput = document.getElementById('upload-folder-placeholder');

        if (uploadSingleInput) {
            uploadSingleInput.addEventListener('change', fileChangeHandler);
            uploadFolderInput.addEventListener('change', fileChangeHandler);
        }

        $scope.$on('selected-items-changed', function () {
            $scope.selectedItemsCount = selectedItemsFactory.getSelectedItems().length;
        });

        $scope.$on('paste-source:set', function () {
            $scope.hasPasteSource = true;
        });

        $scope.$on('paste-source:cleared', function () {
            $scope.hasPasteSource = false;
        });

        $scope.$on('license-loaded', function () {
            vm.isLicensed = licenseFactory.isLicensed();
            vm.archiveUploadAllowed = licenseFactory.isLicensed();

            configurationFactory.getSystemConfiguration().then(function () {
                if (vm.isLicensed) {
                    vm.enableChmod = vm.enableChmod && !configurationFactory.getApplicationSetting('disableChmod');
                    vm.enableFileView = !configurationFactory.getApplicationSetting('disableFileView');
                    vm.enableFileEdit = vm.enableFileView &&
                        !configurationFactory.getApplicationSetting('disableFileEdit');
                    vm.showRemoteServerAddress =
                        !configurationFactory.getApplicationSetting('disableRemoteServerAddressDisplay');

                    vm.itemDisplay = normalizeFooterDisplayOptions(
                        configurationFactory.getApplicationSetting('footerItemDisplay') || {}
                    );
                    updateFooterDisplay();
                }
            }, function (response) {

            });
        });

        $scope.$on('login', function () {
            var currentConfig = authenticationFactory.getActiveConfiguration();
            $scope.currentUsername = currentConfig.username || null;
            $scope.currentHost = currentConfig.host || null;
            $scope.editorActive = false;
            vm.isLoggedIn = true;
        });

        $scope.$on('logout', function () {
            $scope.currentUsername = null;
            $scope.currentHost = null;
            $scope.editorActive = false;
            vm.isLoggedIn = false;
        });

        $scope.$on('file-editor:hide', function (ev, activeFileCount) {
            vm.onEditorHide(activeFileCount);
        });

        $scope.$on("server-capability:key-changed", function (ev, capabilityName, capabilityValue) {
            if (capabilityName === "changePermissions") {
                vm.enableChmod = vm.enableChmod && capabilityValue;
            }
        });

        document.addEventListener("latestVersionLoadEVent", function () {
            updateNewVersionDisplay();
        });

        configurationFactory.getSystemConfiguration().then(function (config) {
            MAX_UPLOAD_BYTES = config.maxFileUpload;
            $scope.maxUploadBytes = MAX_UPLOAD_BYTES;
            $scope.currentVersion = config.version;
            updateNewVersionDisplay();
        }, function (response) {

        });

        function updateNewVersionDisplay() {
            if ($scope.currentVersion && window.MONSTA_LATEST_VERSION)
                $scope.newVersionAvailable = versionIsLessThan($scope.currentVersion, window.MONSTA_LATEST_VERSION);
        }

        function handleUpload() {
            uploadSingleInput.value = null;
            uploadSingleInput.click();
        }

        function fileChangeHandler() {
            if (!this.files || !this.files.length)
                return;

            var items = this.items;

            if (vm.isArchiveUpload && !validateArchiveUpload(this.files))
                return;

            if (items != undefined)
                uploadUIFactory.handleItemsBasedUpload(items, vm.isArchiveUpload ? null : false);
            else
                uploadUIFactory.handleFilesBasedUpload(this.files, vm.isArchiveUpload ? null : false);
        }

        function showModalError(errorMessage) {
            $rootScope.$broadcast("modal-error:show", errorMessage);
        }

        function testFolderUploadSupported() {
            if (folderUploadSupported === null) {
                var tmpInput = document.createElement('input');

                folderUploadSupported = ('webkitdirectory' in tmpInput
                || 'mozdirectory' in tmpInput
                || 'odirectory' in tmpInput
                || 'msdirectory' in tmpInput
                || 'directory' in tmpInput);
            }

            return folderUploadSupported;
        }

        function handleUploadFolder() {
            if (!testFolderUploadSupported()) {
                $translate('FOLDER_UPLOAD_NOT_SUPPORTED_MESSAGE').then(showModalError, showModalError);
                return;
            }

            uploadFolderInput.value = null;
            uploadFolderInput.click();
        }

        function allowAction(actionName) {
            if (actionName == 'show-editor')
                return $scope.editorActive;

            if (actionName == 'paste')
                return $scope.hasPasteSource;

            if (actionsRequiringSelection.indexOf(actionName) == -1)
                return true;

            return $scope.selectedItemsCount != 0;
        }

        function performRemoteFetch(url) {
            $translate('FETCHING_ACTIVITY_STATUS').then(function (translatedBusyMessage) {
                $rootScope.$broadcast("modal-prompt:set-busy", translatedBusyMessage);
            });

            connectionFactory.fetchRemoteFile(url, uiOperationFactory.currentDirectory).then(
                function (response) {
                    if (responseIsUnsuccessful(response)) {
                        showResponseError(response, 'REMOTE_FILE_FETCH_OPERATION', $rootScope, $translate);
                        return;
                    }
                    $rootScope.$broadcast('change-directory');
                    $rootScope.$broadcast('modal-prompt:hide');
                }, function (response) {
                    showResponseError(response, 'REMOTE_FILE_FETCH_OPERATION', $rootScope, $translate);
                    $rootScope.$broadcast("modal-prompt:clear-busy");
                }
            );
        }

        function setModalPromptError(error) {
            $rootScope.$broadcast('modal-prompt:set-error', error);
        }

        function remoteFetchCallback(final) {
            $rootScope.$broadcast('modal-prompt:clear-error');

            if (!basicURLValidate(final)) {
                $translate('URL_INVALID_MESSAGE').then(setModalPromptError, setModalPromptError);
                return;
            }

            var url = final.replace(/^\s\s*/, '');

            vm.performRemoteFetch.call(vm, url);
        }

        function initiateRemoteFetch() {
            $translate(['FETCH_FILE_PROMPT_TITLE', 'FETCH_FILE_URL_PLACEHOLDER']).then(function (translations) {
                $rootScope.$broadcast('modal-prompt:show', translations.FETCH_FILE_PROMPT_TITLE, null,
                    translations.FETCH_FILE_URL_PLACEHOLDER, vm.remoteFetchCallback);
            });
        }

        function onEditorHide(activeFileCount) {
            $scope.editorActive = activeFileCount != 0;
        }

        function showEditor() {
            $rootScope.$broadcast('file-editor:show');
        }

        function validateArchiveUpload(files) {
            var errorMessage = null;
            if (files.length != 1)
                errorMessage = "MULTIPLE_FILE_ARCHIVE_ERROR";
            else if (!isArchiveFilename(files[0].name))
                errorMessage = "INVALID_TYPE_ARCHIVE_ERROR";

            if (errorMessage == null)
                return true;

            $rootScope.$broadcast('modal-error:show', errorMessage);
            return false;
        }

        function buttonClick(buttonName) {
            if (!vm.isLoggedIn)
                return;

            if (buttonName == 'upload-file') {
                vm.isArchiveUpload = false;
                vm.handleUpload();
                return;
            } else if (buttonName == 'upload-folder') {
                vm.isArchiveUpload = false;
                vm.handleUploadFolder();
                return;
            } else if (buttonName == 'upload-archive') {
                vm.isArchiveUpload = true;
                vm.handleUpload();
                return;
            } else if (buttonName == 'fetch-file') {
                vm.initiateRemoteFetch();
                return;
            } else if (buttonName == 'show-editor') {
                if (!vm.allowAction(buttonName))
                    return;

                vm.showEditor();
                return;
            }

            if (!vm.allowAction(buttonName))
                return;

            $rootScope.$broadcast('footer-button-click', buttonName);
        }

        function updateFooterDisplay() {
            var shouldHide = allInterfaceOptionsDisabled(allFooterItems, vm.itemDisplay);

            if (shouldHide) {
                var body = document.getElementsByTagName('body')[0];
                body.classList.add("no-footer");
            }
        }

        function itemHidden(itemId) {
            if (!vm.itemDisplay.hasOwnProperty(itemId))
                return false;

            return vm.itemDisplay[itemId] === false;
        }
    }
}());
(function(){
    angular.module('MonstaFTP').directive('monstaFooterButton', monstaFooterButton);

    monstaFooterButton.$inject = ["$sce"];

    function monstaFooterButton($sce) {
        var template = '<button class="fa fa-fw {{ iconClass }} {{ (activeCondition && vm.isLoggedIn) ? \'active\' : \'inactive\' }}" ' +
            'title="{{ buttonTitle|translate }}" ng-click="vm.buttonClick(buttonIdentifier)" ' +
            'ng-hide="hideCondition" ng-bind-html="trust(extraIcon)"></button>';
        return {
            replace: true,
            scope: {
                iconClass: "&",
                itemTitle: "&",
                activeCondition: "<?",
                identifier: "&",
                vm: "=",
                hideCondition: "<?"
            },
            template: template,
            restrict: 'E',
            link: function ($scope, element, attrs) {
                $scope.trust = $sce.trustAsHtml;

                if (attrs.iconClass === "new-folder-plus") {
                    $scope.iconClass = "fa-folder-o fa-stack";
                    $scope.extraIcon = "<i class='fa fa-plus fa-stack-1x footer-icon-stack'>";
                } else {
                    $scope.iconClass = attrs.iconClass;
                    $scope.extraIcon = "";
                }

                $scope.buttonTitle = attrs.itemTitle;
                if(attrs.activeCondition == undefined)
                    $scope.activeCondition = true;
                $scope.buttonIdentifier = attrs.identifier;
                if(attrs.hideCondition == undefined)
                    $scope.hideCondition = false;
                else
                    $scope.hideCondition = attrs.hideCondition;

                $scope.$watch('vm.itemDisplay', function (newValue, oldValue) {
                    if ($scope.vm.itemHidden($scope.buttonIdentifier)) {
                        $scope.hideCondition = true;
                    }
                });
            }
        }
    }
}());
(function(){
    angular.module('MonstaFTP').directive('monstaFooterMenuItem', monstaFooterMenuItem);

    function monstaFooterMenuItem() {
        var template = '<li class="{{ (activeCondition && vm.isLoggedIn) ? \'active\' : \'inactive\'}}" ' +
            'data-name="{{ buttonIdentifier }}" ng-click="vm.buttonClick(buttonIdentifier)" ng-hide="hideCondition">' +
            '<a href="#"><i class="fa fa-fw {{ iconClass }}"></i> {{ buttonTitle|translate }} </a></li>';
        return {
            replace: true,
            scope: {
                iconClass: "&",
                itemTitle: "&",
                activeCondition: "<?",
                identifier: "&",
                vm: "=",
                hideCondition: "<?"
            },
            template: template,
            restrict: 'E',
            link: function ($scope, element, attrs) {
                $scope.iconClass = attrs.iconClass;
                $scope.buttonTitle = attrs.itemTitle;
                if(attrs.activeCondition == undefined)
                    $scope.activeCondition = true;
                $scope.buttonIdentifier = attrs.identifier;
                if(attrs.hideCondition == undefined)
                    $scope.hideCondition = false;

                $scope.$watch('vm.itemDisplay', function (newValue, oldValue) {
                    if ($scope.vm.itemHidden($scope.buttonIdentifier)) {
                        $scope.hideCondition = true;
                    }
                });
            }
        }
    }
}());
(function(){
    angular.module('MonstaFTP').factory('jQuery', monstaJQuery);

    monstaJQuery.$inject = ['$window'];

    function monstaJQuery($window) {
        return $window.jQuery;
    }
})();
(function () {
    angular.module('MonstaFTP').controller('HistoryController', HistoryController);

    HistoryController.$inject = ['$scope', 'historyFactory', '$rootScope', 'licenseFactory', 'configurationFactory'];

    function HistoryController($scope, historyFactory, $rootScope, licenseFactory, configurationFactory) {
        $scope.history = [];

        var vm = this;
        vm.sortedHistory = [];

        $scope.$on('directory-changed', function () {
            updateHistory();
        });

        $scope.$on('history-changed', function () {
            updateHistory();
        });

        $scope.historyClick = function (path) {
            $rootScope.$broadcast('change-directory', path);
        };

        $scope.$on('items-deleted', function (ev, itemPaths) {
            itemPaths.map(function (path) {
                historyFactory.removeEntry(path);
            });
        });

        $scope.$on('license-loaded', function () {
            if (licenseFactory.isLicensed()) {
                configurationFactory.getSystemConfiguration().then(function () {
                    if(configurationFactory.getApplicationSetting('hideHistoryBar')) {
                        document.getElementsByTagName('body')[0].classList.add('no-history');
                    }
                  }, function () {
                });
            }
        });

        function updateHistory() {
            var fullHistory = historyFactory.getUniqueHistory();
            vm.sortedHistory = fullHistory.sort();
        }
    }
}());
(function () {
    angular.module('MonstaFTP').factory('historyFactory', historyFactory);

    historyFactory.$inject = ['$rootScope'];

    function historyFactory($rootScope) {
        var HISTORY_CHANGED_EVENT_NAME = 'history-changed';
        var ensureTrailingSlash = function (path) {
            return path + (path.substr(path.length - 1) != '/' ? '/' : '');
        };

        var factory = {
            _fullHistory: [],
            _historyIndex: -1,
            getFullHistory: function () {
                return this._fullHistory;
            },
            getFullHistoryCount: function () {
                return this._fullHistory.length;
            },
            addEntry: function (path) {
                path = ensureTrailingSlash(path);

                if (this._historyIndex != this._fullHistory.length - 1)
                    this._fullHistory.splice(this._historyIndex + 1);

                this._fullHistory.push(path);
                ++this._historyIndex;
                $rootScope.$broadcast(HISTORY_CHANGED_EVENT_NAME);
            }, removeEntry: function (path) {
                path = ensureTrailingSlash(path);
                var changed = false;

                for (var i = this._fullHistory.length - 1; i >= 0; --i) {
                    var historyItem = this._fullHistory[i];
                    if (historyItem.length < path.length)
                        continue;

                    if (historyItem.substr(0, path.length) == path) {// this will take care of sub folders
                        this._fullHistory.splice(i, 1);
                        changed = true;
                    }
                }

                if (changed)
                    $rootScope.$broadcast(HISTORY_CHANGED_EVENT_NAME);
            },
            getFullHistoryItem: function (index) {
                return this._fullHistory[index];
            },
            getHistoryIndex: function () {
                return this._historyIndex;
            },
            setHistoryIndex: function (index) {
                this._historyIndex = index;
                $rootScope.$broadcast(HISTORY_CHANGED_EVENT_NAME);
                return this._fullHistory[index];
            },
            hasPreviousHistoryItem: function () {
                return this._historyIndex > 0;
            },
            hasNextHistoryItem: function () {
                return (this._historyIndex > -1) && this._historyIndex < (this._fullHistory.length - 1);
            },
            navigateBack: function () {
                if (!this.hasPreviousHistoryItem())
                    return;

                return this.setHistoryIndex(this.getHistoryIndex() - 1);
            },
            navigateForward: function () {
                if (!this.hasNextHistoryItem())
                    return;

                return this.setHistoryIndex(this.getHistoryIndex() + 1);
            },
            getUniqueHistory: function () {
                if (this.getFullHistoryCount() == 0)
                    return [];

                var uniqueHistory = [];
                for (var fullHistoryIndex = this.getFullHistoryCount(); fullHistoryIndex-- > 0;) {
                    var historyPath = this.getFullHistoryItem(fullHistoryIndex);

                    if (uniqueHistory.indexOf(historyPath) == -1)
                        uniqueHistory.push(historyPath);
                }

                return uniqueHistory;
            },
            clearHistory: function () {
                this._fullHistory = [];
                this._historyIndex = -1;
                $rootScope.$broadcast(HISTORY_CHANGED_EVENT_NAME);
            }
        };

        return factory;
    }
}());
(function () {
    angular.module('MonstaFTP').factory('licenseFactory', licenseFactory);

    licenseFactory.$inject = ['connectionFactory', '$rootScope'];

    function licenseFactory(connectionFactory, $rootScope) {
        return {
            isNullLicense: true,
            email: null,
            version: null,
            expiryDate: null,
            purchaseDate: null,
            productEdition: -1,
            getLicense: function () {
                var _this = this;
                connectionFactory.getLicense().then(function (response) {
                    if (responseIsUnsuccessful(response)) {
                        _this.handleGetFailure.call(_this, response);
                        return;
                    }

                    _this.handleGetSuccess.call(_this, response);
                }, function (response) {
                    _this.handleGetFailure.call(_this, response);
                });
            },
            handleGetSuccess: function (response) {
                var licenseData = response.data.data;
                if (licenseData == null)
                    this.isNullLicense = true;
                else {
                    this.email = licenseData.email;
                    this.version = licenseData.version;
                    this.expiryDate = licenseData.expiryDate * 1000;
                    this.purchaseDate = licenseData.purchaseDate * 1000;
                    this.isTrial = licenseData.isTrial;
                    this.isNullLicense = false;
                    this.productEdition = licenseData.productEdition ? licenseData.productEdition : 0;
                }
                $rootScope.$broadcast('license-loaded');
                var llEvent = document.createEvent("CustomEvent");
                llEvent.initEvent('lload', true, true);
                llEvent.lType = this.productEdition;
                document.dispatchEvent(llEvent);
            }, handleGetFailure: function (response) {
                var action = 'license reading';
                $rootScope.$broadcast('modal-error:show', parseErrorResponse(response, action), null, {action: action});
            }, isLicensed: function () {
                if (this.isNullLicense)
                    return false;

                return !this.isLicenseExpired();
            }, isLicenseExpired: function () {
                if (this.isNullLicense)
                    return false;

                if (this.expiryDate == null)
                    return false;

                return Date.now() > this.expiryDate;
            }, isTrialLicense: function () {
                if (this.isNullLicense)
                    return false;

                return this.isTrial === true;
            }
        };
    }
}());
(function () {
    angular.module('MonstaFTP').controller('ModalLoginLinkController', ModalLoginLinkController);

    ModalLoginLinkController.$inject = ["$rootScope", "$scope", "jQuery", "requestLoginFactory", "$element", "$window",
        "$translate"];

    function ModalLoginLinkController($rootScope, $scope, jQuery, requestLoginFactory, $element, $window, $translate) {
        var vm = this, modalId = '#modal-login-link';

        vm.show = show;
        vm.hide = hide;
        vm.copy = copy;

        $scope.$on('modal-login-link:show', function(ev, type, configuration){
            vm.type = type;
            vm.configuration = configuration;
            vm.show();
        });

        function show() {
            vm.configURL = requestLoginFactory.getConfigURL(vm.type, vm.configuration);
            vm.supportsCopy = browserSupportsCopy();
            jQuery(modalId).modal('show');
        }

        function hide() {
            jQuery(modalId).modal('hide');
            $rootScope.$broadcast('modal-login:show');
        }

        function alertOnCopyFailure(textArea, message) {
            alert(message);
            textArea.select();
        }

        function copy() {
            var textArea = $element.find('textarea')[0];
            textArea.select();
            var copySuccess = false;
            try {
                copySuccess = document.execCommand('copy');
            } catch (err) {
                copySuccess = false;
            }

            if(!copySuccess) {
                $translate("COPY_FAILURE_MESSAGE").then(function(copyFailureMessage){
                    alertOnCopyFailure(textArea, copyFailureMessage);
                }, function () {
                    alertOnCopyFailure(textArea, "Unfortunately your browser does not support automatic copying, " +
                        "please copy the address from the text box.");
                });
            }
        }

        function browserSupportsCopy() {
            var userAgent = $window.navigator.userAgent;
            if(/chrome/i.test(userAgent))
                return true;

            if(/safari/i.test(userAgent))
                return false;

            if(document.queryCommandEnabled == undefined)
                return false;

            return document.queryCommandEnabled('copy');
        }

        jQuery(modalId).on('shown.bs.modal', function(){
            jQuery(this).find("textarea").select();
        });
    }
}());


(function () {
    angular.module('MonstaFTP').controller('LoginPanelController', LoginPanelController);

    LoginPanelController.$inject = ['$scope', 'connectionFactory', 'authenticationFactory', '$rootScope', 'jQuery',
        'licenseFactory', '$translate', 'configurationFactory', 'requestLoginFactory'];

    function LoginPanelController($scope, connectionFactory, authenticationFactory, $rootScope, jQuery,
                                  licenseFactory, $translate, configurationFactory, requestLoginFactory) {
        var modalLoginId = "#modal-login", vm = this, readURL = true, modalSetup = false;

        $scope.connectionErrorMessage = null;
        $scope.storedAuthenticationErrorMessage = null;
        $scope.defaults = g_ConnectionDefaults;
        $scope.metaConfiguration = {
            rememberLogin: false,
            masterPassword: null,
            savedProfileIndex: null,
            enteredProfileName: null
        };

        $scope.hasServerSavedAuthentication = false;
        $scope.savedAuthentication = null;
        $scope.licenseFactory = licenseFactory;
        $scope.metaConfiguration.saveAuthentication = true; // TODO: this is hardcoded until we have a checkbox for this
        $scope.systemConfiguration = {};
        $scope.configuration = {};
        vm.connectionRestrictions = {};
        vm.applicationSettings = {};
        vm.isAuthenticated = false;
        vm.showMissingLanguageMessage = false;
        vm.ftpConnectionAvailable = g_ftpConnectionAvailable;
        vm.showPasswordManagementButton = false;

        vm.buildDefaultConfiguration = buildDefaultConfiguration;
        vm.hide = hide;
        vm.show = show;
        vm.handleError = handleError;
        vm.setupInitialDirectory = setupInitialDirectory;
        vm.writeAuthenticationToServer = writeAuthenticationToServer;
        vm.saveCurrentAuthentication = saveCurrentAuthentication;
        vm.removeProfile = removeProfile;
        vm.initiateAuthenticationSave = initiateAuthenticationSave;
        vm.handleAuthenticationSuccess = handleAuthenticationSuccess;
        vm.handleAuthenticationFailure = handleAuthenticationFailure;
        vm.transferConfigToAuthFactory = transferConfigToAuthFactory;
        vm.successCallback = successCallback;
        vm.handleTestConfiguration = handleTestConfiguration;
        vm.testConfiguration = testConfiguration;
        vm.transferConfigFromAuthFactory = transferConfigFromAuthFactory;
        vm.initWithStoredAuth = initWithStoredAuth;
        vm.updateHasServerSavedAuth = updateHasServerSavedAuth;
        vm.addDefaultsToConfig = addDefaultsToConfig;
        vm.initWithDefaultAuth = initWithDefaultAuth;
        vm.init = init;
        vm.handleCreateAuthSuccess = handleCreateAuthSuccess;
        vm.handleLoadSavedAuthSuccess = handleLoadSavedAuthSuccess;
        vm.handleAuthFileFailure = handleAuthFileFailure;
        vm.performCreateAuthFile = performCreateAuthFile;
        vm.initiateLoadOfAuthFile = initiateLoadOfAuthFile;
        vm.loadProfileAtIndex = loadProfileAtIndex;
        vm.loadNewProfile = loadNewProfile;
        vm.configurationSettable = configurationSettable;
        vm.applyRestrictionsToConfiguration = applyRestrictionsToConfiguration;
        vm.shouldShowProUpgrade = shouldShowProUpgrade;
        vm.shouldShowProfiles = shouldShowProfiles;
        vm.showLoginLink = showLoginLink;
        vm.initWithURLConfig = initWithURLConfig;
        vm.initWithPostedConfig = initWithPostedConfig;
        vm.profileIsSelected = profileIsSelected;
        vm.getProfileName = getProfileName;
        vm.getDefaultProfileName = getDefaultProfileName;
        vm.showDisabledSFTPAuthMessage = showDisabledSFTPAuthMessage;
        vm.selectTab = selectTab;
        vm.showPasswordManager = showPasswordManager;

        $scope.connect = function () {
            $scope.connectionErrorMessage = null;  // hide error message when connect is clicked
            vm.testConfiguration("form");
        };

        $scope.handleLoginKeyPress = function ($event) {
            if ($event.which == 13)
                $scope.connect();
        };

        $scope.$on('logout', function () {
            readURL = false;

            var logoutHandled = false;

            if (licenseFactory.isLicensed()) {
                var logoutUrl = configurationFactory.getApplicationSetting('postLogoutUrl');

                if (logoutUrl != null) {
                    logoutHandled = true;  // this is somewhat pointless as we're redirecting anyway
                    window.setTimeout(function () {
                        window.location = logoutUrl;
                    }, 200); // wait to let other things do their thing
                }
            }

            if (!logoutHandled)
                vm.init(true);
        });

        $scope.$on('modal-login:show', function () {
            vm.show();
        });

        function setStoredAuthenticationErrorMessage(errorMessage) {
            $scope.storedAuthenticationErrorMessage = errorMessage;
        }

        $scope.handleAuthGo = function () {
            $scope.connectionErrorMessage = null;
            if (isEmpty($scope.metaConfiguration.masterPassword)) {
                $translate('PROFILE_SET_PASSWORD_ERROR').then(setStoredAuthenticationErrorMessage,
                    setStoredAuthenticationErrorMessage);
                return;
            }

            $scope.storedAuthenticationErrorMessage = '';

            if ($scope.hasServerSavedAuthentication)
                vm.initiateLoadOfAuthFile();
            else
                vm.performCreateAuthFile();
        };

        $scope.masterPasswordKeypress = function ($event) {
            if ($event.which == 13)
                $scope.handleAuthGo();
        };

        $scope.handleProfileChange = function () {
            $scope.connectionErrorMessage = null;
            var selectValue = $scope.metaConfiguration.savedProfileIndex;
            if (selectValue == 'new') {
                vm.loadNewProfile();
                return;
            }

            var profileIndex = parseInt(selectValue);
            if (!isNaN(profileIndex))
                vm.loadProfileAtIndex(profileIndex);
        };

        function showRemoveProfileConfirm(message) {
            $rootScope.$broadcast('modal-confirm:show', message, vm.removeProfile);
        }

        $scope.initiateProfileDelete = function () {
            $translate('PROFILE_DELETE_CONFIRM_MESSAGE').then(showRemoveProfileConfirm, showRemoveProfileConfirm)
        };

        $scope.shouldHideDeleteButton = function () {
            if (!shouldShowProfiles())
                return true;

            return isNaN(parseInt($scope.metaConfiguration.savedProfileIndex));
        };

        $scope.$on('license-loaded', function () {
            vm.init();
        });

        configurationFactory.getSystemConfiguration().then(function (systemConfiguration) {
            vm.sshAgentAuthEnabled = systemConfiguration.sshAgentAuthEnabled;
            vm.sshKeyAuthEnabled = systemConfiguration.sshKeyAuthEnabled;

            $scope.systemConfiguration = systemConfiguration;
            vm.applicationSettings = systemConfiguration.applicationSettings;
            vm.connectionRestrictions = systemConfiguration.applicationSettings.connectionRestrictions;
            licenseFactory.getLicense();
        }, function (response) {
            licenseFactory.getLicense();
        });

        function buildDefaultConfiguration() {
            var availableConnectionTypes = [
                ['ftp', 'FTP'],
                ['sftp', 'SFTP/SCP']
            ];

            if (DEBUG)
                availableConnectionTypes.push(['mock', 'Mock']);

            $scope.connectionTypes = [];

            for (var ctIndex = 0; ctIndex < availableConnectionTypes.length; ++ctIndex) {
                if (connectionTypeAllowed(availableConnectionTypes[ctIndex][0]))
                    $scope.connectionTypes.push(availableConnectionTypes[ctIndex]);
            }

            $scope.configuration = {};
            if ($scope.connectionTypes.length)
                $scope.connectionType = $scope.connectionTypes[0][0];

            for (ctIndex = 0; ctIndex < $scope.connectionTypes.length; ++ctIndex)
                $scope.configuration[$scope.connectionTypes[ctIndex][0]] = {};
        }

        function hide() {
            jQuery(modalLoginId).modal('hide');
        }

        function show() {
            var modalConfig = {};
            vm.isAuthenticated = authenticationFactory.isAuthenticated;

            if (!authenticationFactory.isAuthenticated) {
                modalConfig.backdrop = 'static';
                modalConfig.keyboard = false;
            } else {
                modalConfig.backdrop = true;
                modalConfig.keyboard = true;
            }

            vm.updateHasServerSavedAuth();

            var $modal = jQuery(modalLoginId);

            if (!modalSetup) {
                $modal.modal(modalConfig);
                modalSetup = true;
            } else {
                $modal.data('bs.modal').options.backdrop = modalConfig.backdrop;
                $modal.data('bs.modal').options.keyboard = modalConfig.keyboard;
            }

            if(g_isNewWindowsInstall) {
                $modal.on('shown.bs.modal', function () {
                   vm.showMissingLanguageMessage = jQuery('#modal-login-label').text() === "LOGIN";
                   $scope.$apply();
                });
            }

            $modal.modal('show');
        }

        function displayTranslatedError(errorMessage, mode) {
            if (mode == 'connection-display')
                $scope.connectionErrorMessage = errorMessage;
            else if (mode == 'saved-profile-display')
                $scope.storedAuthenticationErrorMessage = errorMessage;
            else
                $rootScope.$broadcast('modal-error:show', errorMessage);
        }

        function handleErrorWithTranslatedAction(localizedError, response, action, context, mode) {
            var errorMessage;

            if (localizedError == null)
                errorMessage = parseErrorResponse(response, action);
            else {
                errorMessage = localizedError.errorName;
                if (localizedError.context != undefined) {
                    context = localizedError.context;
                }
            }

            context.action = action;

            $translate(errorMessage, context).then(function (translatedMessage) {
                displayTranslatedError(translatedMessage, mode);
            }, function () {
                displayTranslatedError(errorMessage, mode);
            });
        }

        function handleError(response, action, mode) {
            var localizedError = getLocalizedErrorFromResponse(response);

            var context = {};
            $translate(action).then(function (translatedAction) {
                handleErrorWithTranslatedAction(localizedError, response, translatedAction, context, mode);
            }, function () {
                handleErrorWithTranslatedAction(localizedError, response, action, context, mode);
            });
        }

        function addMissingLeadingSlash(path) {
            return path.substr(0, 1) != "/" ? ("/" + path) : path;
        }

        function setupInitialDirectory(resumeType) {
            var configuration = $scope.configuration, connType = $scope.connectionType; // for shorter refs :)
            if (resumeType == "resume") {
                var authInitDir = authenticationFactory.initialDirectory;
                if (isEmpty(authInitDir))
                    authInitDir = "/";

                configuration[connType].initialDirectory = addMissingLeadingSlash(authInitDir);
            } else {
                if (isEmpty(configuration[connType].initialDirectory))
                    configuration[connType].initialDirectory = "/";

                configuration[connType].initialDirectory =
                    addMissingLeadingSlash(configuration[connType].initialDirectory);

                authenticationFactory.initialDirectory = configuration[connType].initialDirectory;
            }
        }

        function writeAuthenticationToServer() {
            connectionFactory.writeSavedAuth($scope.metaConfiguration.masterPassword, $scope.savedAuthentication)
                .then(function (response) {
                    if (responseIsUnsuccessful(response))
                        vm.handleError(response, 'saving profile');
                }, function (response) {
                    vm.handleError(response, 'saving profile');
                });
        }

        function saveCurrentAuthentication() {
            if ($scope.savedAuthentication == null || typeof $scope.savedAuthentication != 'object')
                $scope.savedAuthentication = {};

            if ($scope.savedAuthentication[$scope.connectionType] == undefined)
                $scope.savedAuthentication[$scope.connectionType] = [];

            var profileToSave = angular.copy($scope.configuration[$scope.connectionType]);

            profileToSave.name = $scope.metaConfiguration.enteredProfileName;

            var profileArray = $scope.savedAuthentication[$scope.connectionType];

            if ($scope.metaConfiguration.savedProfileIndex == 'new')
                profileArray.push(profileToSave);
            else
                profileArray[$scope.metaConfiguration.savedProfileIndex] = profileToSave;

            vm.writeAuthenticationToServer();
        }

        function removeProfile() {
            $scope.savedAuthentication[$scope.connectionType].splice($scope.metaConfiguration.savedProfileIndex, 1);

            $scope.metaConfiguration.savedProfileIndex = Math.min($scope.metaConfiguration.savedProfileIndex,
                $scope.savedAuthentication[$scope.connectionType].length - 1);

            vm.writeAuthenticationToServer();
        }

        function initiateAuthenticationSave() {
            if (isEmpty($scope.metaConfiguration.masterPassword) || !$scope.metaConfiguration.saveAuthentication
                || !$scope.hasServerSavedAuthentication)
                return;

            vm.saveCurrentAuthentication();
        }

        function extractServerCapabilitiesFromResponse(response) {
            if (response.data == undefined) {
                return {};
            }

            if (response.data.data == undefined) {
                return {};
            }

            if (response.data.data.serverCapabilities == undefined) {
                return {};
            }

            return response.data.data.serverCapabilities
        }

        function handleAuthenticationSuccess(response) {
            var serverCapabilities = extractServerCapabilitiesFromResponse(response);

            for(var capabilityName in serverCapabilities) {
                if (serverCapabilities.hasOwnProperty(capabilityName)) {
                    configurationFactory.setServerCapability(capabilityName, serverCapabilities[capabilityName]);
                }
            }

            authenticationFactory.postLogin();
            vm.initiateAuthenticationSave();
            vm.hide();
            $rootScope.$broadcast('login');
        }

        function handleAuthenticationFailure(resumeType, response) {
            if (resumeType == "resume" || resumeType == "url") {
                if (resumeType == "url") {
                    $scope.configuration[$scope.connectionType].password = null;
                    authenticationFactory.configuration[$scope.connectionType].password = null;
                }
                vm.show();
            } else
                vm.handleError(response, 'authentication', 'connection-display');
        }

        function transferConfigToAuthFactory(resumeType) {
            var config = angular.copy($scope.configuration);
            vm.applyRestrictionsToConfiguration(config);
            authenticationFactory.configuration = config;
            if (resumeType != "resume")
                authenticationFactory.initialDirectory = config[$scope.connectionType].initialDirectory;
            authenticationFactory.connectionType = $scope.connectionType;
            authenticationFactory.rememberLogin = $scope.metaConfiguration.rememberLogin;
            authenticationFactory.hasServerSavedAuthentication = $scope.hasServerSavedAuthentication;
        }

        function successCallback(resumeType, response) {
            if (responseIsUnsuccessful(response))
                vm.handleAuthenticationFailure(resumeType, response);
            else
                vm.handleAuthenticationSuccess(response);
        }

        function handleTestConfiguration(resumeType) {
            connectionFactory.testConnectAndAuthenticate(true).then(function (response) {
                vm.successCallback(resumeType, response);
            }, function (response) {
                vm.handleAuthenticationFailure(resumeType, response);
            });
        }

        function testConfiguration(resumeType) {
            vm.setupInitialDirectory(resumeType);
            vm.transferConfigToAuthFactory(resumeType);
            vm.handleTestConfiguration(resumeType);
        }

        function transferConfigFromAuthFactory() {
            $scope.connectionType = authenticationFactory.connectionType || $scope.connectionTypes[0][0];

            if (!connectionTypeAllowed($scope.connectionType))
                $scope.connectionType = $scope.connectionTypes[0][0];

            $scope.metaConfiguration.rememberLogin = authenticationFactory.rememberLogin;
            $scope.hasServerSavedAuthentication = authenticationFactory.hasServerSavedAuthentication;
        }

        function initWithStoredAuth(wasLogout) {
            $scope.configuration = angular.copy(authenticationFactory.configuration);

            var restrictionsApplied = vm.applyRestrictionsToConfiguration($scope.configuration);

            if (!wasLogout && (restrictionsApplied || authenticationFactory.isAuthenticated))
                vm.testConfiguration("resume");
            else
                vm.show();
        }

        function initWithURLConfig(urlConfig, wasLogout) {
            var configuration = {};

            configuration[urlConfig.type] = urlConfig.configuration;

            authenticationFactory.configuration = angular.copy(configuration);

            $scope.configuration = angular.copy(configuration);
            vm.applyRestrictionsToConfiguration(configuration);
            $scope.connectionType = urlConfig.type;
            if(!wasLogout)
                vm.testConfiguration("url");
            else
                vm.show();
        }

        function initWithPostedConfig() {
            var configuration = angular.copy(g_monstaPostEntryVars);
            delete configuration['settings'];

            authenticationFactory.configuration = angular.copy(configuration);
            $scope.configuration = angular.copy(configuration);
            vm.applyRestrictionsToConfiguration(configuration);
            $scope.connectionType = configuration.type;
            vm.testConfiguration("url");
        }

        function updateHasServerSavedAuth() {
            connectionFactory.checkSavedAuthExists().then(function (response) {
                $scope.hasServerSavedAuthentication = (response.data.data === true);
            }, function () {
                vm.isAuthenticated = false;
                $scope.hasServerSavedAuthentication = false;
            });
        }

        function addDefaultsToConfig() {
            if ($scope.configuration.ftp) // will not exist if in sftp only mode
                $scope.configuration.ftp.passive = true;
        }

        function initWithDefaultAuth(wasLogout) {
            vm.addDefaultsToConfig();
            var restrictionsApplied = vm.applyRestrictionsToConfiguration($scope.configuration);
            if (restrictionsApplied && !wasLogout)
                testConfiguration("resume");
            else
                vm.show();
        }

        function init(wasLogout) {
            wasLogout = !!wasLogout;
            vm.buildDefaultConfiguration();
            authenticationFactory.loadSettings();
            vm.transferConfigFromAuthFactory();

            if (licenseFactory.isLicensed()) {
                if (licenseFactory.productEdition === 1) {
                    vm.showPasswordManagementButton =
                        (g_forgotPasswordAvailable && configurationFactory.getApplicationSetting("enableForgotPassword"))
                        ||
                        (g_resetPasswordAvailable && configurationFactory.getApplicationSetting("enableResetPassword"));
                }
            }

            var configFromURL = null;

            if (readURL && licenseFactory.isLicensed())
                configFromURL = requestLoginFactory.getConfigFromCurrentURL();

            if (configFromURL != null)
                vm.initWithURLConfig(configFromURL, wasLogout);
            else if (readURL && licenseFactory.isLicensed() && g_isMonstaPostEntry)
                vm.initWithPostedConfig();
            else if (authenticationFactory.hasStoredAuthenticationDetails())
                vm.initWithStoredAuth(wasLogout);
            else
                vm.initWithDefaultAuth(wasLogout);
        }

        function handleCreateAuthSuccess() {
            $scope.masterPasswordValid = true;
            $scope.hasServerSavedAuthentication = true;
        }

        function handleLoadSavedAuthSuccess(response) {
            $scope.savedAuthentication = response.data.data;
            $scope.masterPasswordValid = true;
        }

        function handleAuthFileFailure(response) {
            $scope.masterPasswordValid = false;
            vm.handleError(response, 'reading/writing the settings file', 'saved-profile-display');
        }

        function performCreateAuthFile() {
            var defaultAuth = {};

            for (var tIndex = 0; tIndex < $scope.connectionTypes.length; ++tIndex) {
                defaultAuth[$scope.connectionTypes[tIndex][0]] = [];
            }

            connectionFactory.writeSavedAuth($scope.metaConfiguration.masterPassword, defaultAuth).then(
                function (response) {
                    if (responseIsUnsuccessful(response))
                        vm.handleAuthFileFailure(response);
                    else
                        vm.handleCreateAuthSuccess(response);
                }, function (response) {
                    vm.handleAuthFileFailure(response);
                });
        }

        function initiateLoadOfAuthFile() {
            connectionFactory.readSavedAuth($scope.metaConfiguration.masterPassword).then(function (response) {
                if (responseIsUnsuccessful(response))
                    vm.handleAuthFileFailure(response);
                else
                    vm.handleLoadSavedAuthSuccess(response);
            }, function (response) {
                vm.handleAuthFileFailure(response);
            });
        }

        function loadProfileAtIndex(profileIndex) {
            $scope.configuration[$scope.connectionType] = angular.copy(
                $scope.savedAuthentication[$scope.connectionType][profileIndex]);

            $scope.metaConfiguration.enteredProfileName = $scope.configuration[$scope.connectionType].name;
        }

        function loadNewProfile() {
            $scope.configuration[$scope.connectionType] = {};
            $scope.metaConfiguration.enteredProfileName = null;
            vm.addDefaultsToConfig();
        }

        function configurationSettable(connectionType, configurationKey) {
            if (vm.connectionRestrictions == null || typeof (vm.connectionRestrictions) != "object")
                return true;

            if (!vm.connectionRestrictions.hasOwnProperty(connectionType))
                return true;

            return !vm.connectionRestrictions[connectionType].hasOwnProperty(configurationKey);
        }

        function applyRestrictionsToConfiguration(configuration) {
            if (vm.connectionRestrictions == null || typeof (vm.connectionRestrictions) != "object")
                return false;

            var restrictionsApplied = false;

            for (var connectionType in vm.connectionRestrictions) {
                if (!vm.connectionRestrictions.hasOwnProperty(connectionType))
                    continue;

                if (!configuration.hasOwnProperty(connectionType))
                    continue;

                var typeConnectionSettings = vm.connectionRestrictions[connectionType];
                if (typeConnectionSettings == null || typeof (vm.connectionRestrictions) != "object")
                    continue;

                restrictionsApplied = applySingleConnectionRestriction(configuration, connectionType,
                    typeConnectionSettings);
            }

            return restrictionsApplied;
        }

        function applySingleConnectionRestriction(configuration, connectionType, typeConnectionSettings) {
            var connectionTypeSettings = configuration[connectionType];

            var restrictionApplied = false;

            for (var settingName in typeConnectionSettings) {
                if (!typeConnectionSettings.hasOwnProperty(settingName))
                    continue;

                if (typeConnectionSettings[settingName] === true || typeConnectionSettings[settingName] === 1)
                    configuration[connectionType][settingName] = null;
                else {
                    var configurationValue = typeConnectionSettings[settingName];

                    if (configurationValue != null) {
                        var mfunc = new MessageFormat('en').compile(configurationValue);

                        configurationValue = mfunc(
                            {'username': connectionTypeSettings.remoteUsername || connectionTypeSettings.username});
                    } else if (settingName == "initialDirectory")
                        return false;

                    configuration[connectionType][settingName] = configurationValue
                }
                restrictionApplied = true;
            }

            return restrictionApplied;
        }

        function connectionTypeAllowed(connectionType) {
            // this function is designed to be very forgiving
            if (vm.connectionRestrictions == null || typeof (vm.connectionRestrictions) != "object")
                return true;

            if (Object.prototype.toString.call(vm.connectionRestrictions.types) != '[object Array]')
                return true;

            if (vm.connectionRestrictions.types.length == 0)
                return true;

            return vm.connectionRestrictions.types.indexOf(connectionType) != -1;
        }

        function shouldShowProUpgrade() {
            if (vm.applicationSettings.hideProUpgradeMessages === true)
                return false;

            return !licenseFactory.isLicensed();
        }

        function shouldShowProfiles() {
            if (vm.applicationSettings.disableMasterLogin === true)
                return false;

            return licenseFactory.isLicensed();
        }

        function showLoginLink() {
            $rootScope.$broadcast("modal-login-link:show", $scope.connectionType,
                $scope.configuration[$scope.connectionType]);
            vm.hide();
        }

        function profileIsSelected() {
            return $scope.metaConfiguration.savedProfileIndex !== ''
                && $scope.metaConfiguration.savedProfileIndex !== null;
        }

        function getProfileName(profile, useDefault) {
            if (profile == undefined)
                return '';

            if (!useDefault && profile.name)
                return profile.name;

            if (profile.host == null || (profile.username == null && profile.remoteUsername == null))
                return '';

            return (profile.host || 'host') + " / " + (profile.username || profile.remoteUsername || 'username');
        }

        function getDefaultProfileName() {
            if ($scope == null || $scope.configuration == null || $scope.connectionType == null)
                return '';

            return getProfileName($scope.configuration[$scope.connectionType], true);
        }

        function showDisabledSFTPAuthMessage() {
            if ($scope.configuration.sftp == undefined)
                return false;

            return (
                (vm.sshAgentAuthEnabled == false && $scope.configuration.sftp.authenticationModeName == "Agent") ||
                (vm.sshKeyAuthEnabled == false && $scope.configuration.sftp.authenticationModeName == "PublicKeyFile")
            );
        }

        function selectTab(tabId) {
            $scope.connectionType = tabId;
            window.setTimeout(function () {
                $scope.$apply(function () {
                    $scope.handleProfileChange();
                });
            });
        }

        function showPasswordManager() {
            vm.hide();
            $rootScope.$broadcast('modal-password-management:show');
        }
    }
}());
(function () {
    angular.module('MonstaFTP').controller('ModalAddonsController', ModalAddonsController);

    ModalAddonsController.$inject = ['jQuery', 'licenseFactory', '$scope', '$filter', 'connectionFactory',
        '$translate'];

    function ModalAddonsController(jQuery, licenseFactory, $scope, $filter, connectionFactory, $translate) {
        var modalId = '#modal-addons', vm = this;

        vm.show = show;
        vm.updateLicense = updateLicense;
        vm.selectTab = selectTab;

        vm.models = {license: ''};
        vm.licenseUpdateError = null;
        vm.activeTab = 'addon-current';
        vm.productEditionShortName = "STARTER_EDITION";
        vm.openSslAvailable = g_openSslAvailable;

        $scope.$on('modal-addons:show', function () {
            vm.show();
        });

        $scope.$on('license-loaded', function () {
           refreshLicenseData();
        });

        function updateLicense() {
            if(!vm.openSslAvailable)
                return;

            vm.licenseUpdateError = null;
            connectionFactory.updateLicense(vm.models.license).then(function () {
                licenseFactory.getLicense();
                vm.models.license = '';
            }, function (response) {
                var localizedError = response.data.localizedErrors[0];

                $translate(localizedError.errorName, localizedError.context).then(function (translatedMessage) {
                    vm.licenseUpdateError = translatedMessage;
                }, function () {
                    vm.licenseUpdateError = errorMessage;
                });
            });
        }

        function refreshLicenseData() {
            vm.formattedExpiryDate = $filter('date')(licenseFactory.expiryDate, "d MMMM, yyyy");
            vm.licenseExpired = licenseFactory.isLicenseExpired();
            vm.isLicensed = licenseFactory.isLicensed();
            vm.isTrialLicense = licenseFactory.isTrialLicense();

            if(!vm.isLicensed)
                vm.productEditionShortName = "STARTER_EDITION";
            else if (licenseFactory.productEdition == 1)
                vm.productEditionShortName = "ENTERPRISE_EDITION";
            else
                vm.productEditionShortName = "PROFESSIONAL_EDITION";
        }

        function show() {
            refreshLicenseData();
            jQuery(modalId).modal('show');
        }

        function selectTab(tabId) {
            vm.activeTab = tabId;
            window.setTimeout(function () {
                $scope.$apply();
            });
        }
    }
}());
(function () {
    angular.module('MonstaFTP').controller('ModalChoiceController', ModalChoiceController);

    ModalChoiceController.$inject = ["$scope", "jQuery", '$timeout'];

    function ModalChoiceController($scope, jQuery, $timeout) {
        var vm = this, modalId = "#modal-choice";
        vm.callbacks = [];
        vm.cancelCallback = null;
        vm.title = null;
        vm.message = null;
        vm.show = show;
        vm.handleCallback = handleCallback;
        vm.handleCancel = handleCancel;

        function replaceAllInString(str, search, replacement) {
            return str.replace(new RegExp(search, 'g'), replacement);
        }

        $scope.$on('modal-choice:show', function (ev, title, message, cancelCallback, callbacks) {
            message = replaceAllInString(message, "TAG_STRONG_START", "<strong>");
            message = replaceAllInString(message, "TAG_STRONG_END", "</strong>");

            vm.title = title;
            vm.message = message;
            vm.callbacks = callbacks;
            vm.cancelCallback = cancelCallback;

            $timeout(function () {
                $scope.$apply(function () {
                    vm.show();
                });
            });
        });

        function show() {
            jQuery(modalId).modal('show');
        }

        function hide(callback) {
            if(callback != null) {
                jQuery(modalId).on('hidden.bs.modal', function () {
                    jQuery(modalId).off('hidden.bs.modal');
                    if (callback != null)
                        callback();
                });
            }

            jQuery(modalId).modal('hide');
        }

        function handleCallback(callbackIndex) {
            hide(vm.callbacks[callbackIndex][1]);
        }

        function handleCancel() {
            hide(vm.cancelCallback);
        }
    }
}());
(function () {
    angular.module('MonstaFTP').controller('ModalConfirmController', ['$scope', 'jQuery', ModalConfirmController]);

    function ModalConfirmController($scope, jQuery) {
        var modalConfirmId = '#modal-confirm', vm = this;

        vm.message = '';
        vm.okCallback = null;
        vm.cancelCallback = null;

        vm.show = show;
        vm.ok = okHandler;
        vm.cancel = cancelHandler;

        $scope.$on('modal-confirm:show', function (ev, message, okCallback, cancelCallback) {
            vm.message = message;
            vm.okCallback = (typeof okCallback == 'undefined') ? null : okCallback;
            vm.cancelCallback = (typeof cancelCallback == 'undefined') ? null : cancelCallback;
            vm.show();
        });

        function okHandler() {
            jQuery(modalConfirmId).modal('hide');
            if (vm.okCallback != null) {
                vm.okCallback();
                vm.okCallback = null;
            }
        }

        function cancelHandler() {
            jQuery(modalConfirmId).modal('hide');
            if (vm.cancelCallback != null) {
                vm.cancelCallback();
                vm.cancelCallback = null;
            }
        }

        function show() {
            jQuery(modalConfirmId).modal('show');
        }
    }
}());
(function () {
    angular.module('MonstaFTP').controller('ModalErrorController', ModalErrorController);

    ModalErrorController.$inject = ['$scope', 'jQuery', '$translate'];

    function ModalErrorController($scope, jQuery, $translate) {
        var vm = this, modalErrorId = '#modal-error';
        vm.message = '';
        vm.show = show;
        vm.hide = hide;
        vm.dismissCallback = dismissCallback;

        $scope.$on('modal-error:show', function (ev, message, dismissCallback, context) {
            $translate(message, context).then(function(translatedMessage){
                vm.message = translatedMessage;
            }, function () {
                vm.message = message;
            });

            vm.dismissCallback = dismissCallback;
            jQuery(modalErrorId).modal('show');
        });

        jQuery(modalErrorId).on('shown.bs.modal', function () {
            $scope.$apply();
        });

        function show() {
            jQuery(modalErrorId).modal('show');
        }

        function hide() {
            jQuery(modalErrorId).modal('hide');
            if (vm.dismissCallback)
                vm.dismissCallback();
        }

        function dismissCallback() {
            // empty
        }
    }

}());

(function () {
    angular.module('MonstaFTP').controller('ModalPasswordManagementController', ['$scope', 'jQuery', '$rootScope',
        'connectionFactory', 'licenseFactory', 'configurationFactory', ModalPasswordManagementController]);

    function ModalPasswordManagementController($scope, jQuery, $rootScope, connectionFactory, licenseFactory,
                                               configurationFactory) {
        var modalId = '#modal-password-management', vm = this;

        vm.forgotPasswordAvailable = false;
        vm.resetPasswordAvailable = false;

        vm.forgotPasswordFailed = false;
        vm.forgotPasswordSucceeded = false;

        vm.resetPasswordFailed = false;
        vm.resetPasswordSucceeded = false;

        vm.forgotPasswordFailedMessage = "FORGOT_PASSWORD_FAILED";
        vm.forgotPasswordSucceededMessage = "FORGOT_PASSWORD_SUCCEEDED";

        vm.resetPasswordFailedMessage = "RESET_PASSWORD_FAILED";
        vm.resetPasswordSucceededMessage = "RESET_PASSWORD_SUCCEEDED";

        vm.show = show;
        vm.showLoginPanel = showLoginPanel;
        vm.initiateForgotPassword = initiateForgotPassword;
        vm.initiateResetPassword = initiateResetPassword;

        resetModel();

        $scope.$on('modal-password-management:show', function () {
            vm.show();
        });

        $scope.$on('license-loaded', function () {
            if (licenseFactory.isLicensed() && licenseFactory.productEdition === 1) {
                configurationFactory.getSystemConfiguration().then(function () {
                    vm.resetPasswordAvailable = g_resetPasswordAvailable && configurationFactory.getApplicationSetting("enableResetPassword");
                    vm.forgotPasswordAvailable = g_forgotPasswordAvailable && configurationFactory.getApplicationSetting("enableForgotPassword");

                    if (vm.forgotPasswordAvailable)
                        vm.currentTab = 'forgot';
                    else
                        vm.currentTab = 'reset';
                }, function () {
                });
            }
        });

        function resetModel() {
            vm.model = {
                forgotPasswordUsername: '',
                resetPasswordUsername: '',
                currentPassword: '',
                resetPassword: '',
                confirmPassword: ''
            };
        }

        function show() {
            resetModel();
            jQuery(modalId).modal('show');
        }

        function hide() {
            jQuery(modalId).modal('hide');
        }

        function showLoginPanel() {
            hide();
            $rootScope.$broadcast('modal-login:show');
        }

        function getFirstResponseError(response, defaultError) {
            if (response.data != undefined && response.data.errors != undefined && response.data.errors.length > 0 &&
                response.data.errors[0] != '')
                return response.data.errors[0];

            return defaultError;
        }

        function getResponseSuccessMessage(response, defaultMessage) {
            if (response.data != undefined && response.data.data != undefined && response.data.data != '')
                return response.data.data;

            return defaultMessage;
        }

        function initiateForgotPassword() {
            vm.forgotPasswordFailed = false;
            vm.forgotPasswordSucceeded = false;

            if (vm.model.forgotPasswordUsername === '') {
                vm.forgotPasswordFailedMessage = 'FORM_INCOMPLETE_ERROR';
                vm.forgotPasswordFailed = true;
                return;
            }

            connectionFactory.forgotPassword(vm.model.forgotPasswordUsername).then(function (response) {
                vm.forgotPasswordSucceededMessage = getResponseSuccessMessage(response, "FORGOT_PASSWORD_SUCCEEDED");
                vm.forgotPasswordSucceeded = true;
            }, function (response) {
                vm.forgotPasswordFailedMessage = getFirstResponseError(response, "FORGOT_PASSWORD_FAILED");

                vm.forgotPasswordFailed = true;
            });
        }

        function initiateResetPassword() {
            vm.resetPasswordFailed = false;
            vm.resetPasswordSucceeded = false;

            if (vm.model.resetPasswordUsername === '' || vm.model.currentPassword === '' ||
                vm.model.resetPassword === '' || vm.model.confirmPassword === '') {
                vm.resetPasswordFailedMessage = 'FORM_INCOMPLETE_ERROR';
                vm.resetPasswordFailed = true;
                return;
            }

            if (vm.model.resetPassword !== vm.model.confirmPassword) {
                vm.resetPasswordFailedMessage = 'PASSWORD_MISMATCH_ERROR';
                vm.resetPasswordFailed = true;
                return;
            }

            connectionFactory.resetPassword(vm.model.resetPasswordUsername, vm.model.currentPassword, vm.model.resetPassword).then(function (response) {
                vm.resetPasswordSucceededMessage = getResponseSuccessMessage(response, "RESET_PASSWORD_SUCCEEDED");
                vm.resetPasswordSucceeded = true;
            }, function (response) {
                vm.resetPasswordFailedMessage = getFirstResponseError(response, "RESET_PASSWORD_FAILED");
                vm.resetPasswordFailed = true;
            });
        }
    }
}());
(function () {
    angular.module('MonstaFTP').controller('ModalPermissionsController', ModalPermissionsController);

    ModalPermissionsController.$inject = ['$scope', '$rootScope', 'connectionFactory', 'jQuery', 'permissionsFactory',
        '$translate'];

    function ModalPermissionsController($scope, $rootScope, connectionFactory, jQuery, permissionsFactory, $translate) {
        var modalPermissionsEditorId = '#modal-chmod', vm = this;
        $scope.filePaths = null;
        $scope.permissions = null;
        $scope.formattedPermissions = null;
        $scope.invalidRange = false;
        $scope.saving = false;

        vm.show = show;
        vm.hide = hide;
        vm.validateFormattedPermission = validateFormattedPermission;
        vm.formattedPermissionsChange = formattedPermissionsChange;
        vm.setPermissions = setPermissions;
        vm.zeroPadLeft = zeroPadLeft;
        vm.setFormattedPermissions = setFormattedPermissions;
        vm.permissionsChange = permissionsChange;
        vm.permissionSaveError = permissionSaveError;
        vm.permissionSaveSuccess = permissionSaveSuccess;
        vm.initiatePermissionsSave = initiatePermissionsSave;

        $scope.$on('modal-permissions:show', function (ev, filePaths, numericPermissions) {
            $scope.filePaths = filePaths;
            vm.setPermissions(numericPermissions);
            vm.show();
        });

        $scope.$watch('permissions', vm.permissionsChange, true);

        $scope.$watch('formattedPermissions', vm.formattedPermissionsChange);

        $scope.manualFocus = function () {
            $scope.invalidRange = false;
        };

        $scope.okClick = function () {
            if ($scope.invalidRange)
                return;

            vm.initiatePermissionsSave();
        };

        $scope.cancelClick = function () {
            vm.hide();
        };

        function show() {
            jQuery(modalPermissionsEditorId).modal('show');
            $scope.invalidRange = false;
        }

        function hide() {
            $scope.filePaths = null;
            $scope.invalidRange = false;
            jQuery(modalPermissionsEditorId).modal('hide');
        }

        function setPermissions(numericPermissions) {
            $scope.permissions = permissionsFactory.numericToObject(numericPermissions);
        }

        function zeroPadLeft(input) {
            while (input.length < 3)
                input = '0' + input;

            return input;
        }

        function setFormattedPermissions(numericPermissions) {
            $scope.formattedPermissions = vm.zeroPadLeft(numericPermissions.toString(8));
        }

        function permissionsChange() {
            if ($scope.permissions != null)
                vm.setFormattedPermissions(permissionsFactory.objectToNumeric($scope.permissions));
        }

        function validateFormattedPermission(formattedPermission) {
            var numericPermissions = parseInt(formattedPermission, 8);
            if (isNaN(numericPermissions) || numericPermissions < 0 || numericPermissions > 511) {
                numericPermissions = 0;
                $scope.invalidRange = true;
            }
            return numericPermissions;
        }

        function formattedPermissionsChange() {
            vm.setPermissions(vm.validateFormattedPermission($scope.formattedPermissions));
        }

        function permissionSaveError(error, context) {
            $scope.saving = false;
            $translate(['PERMISSIONS_FAILURE_PRECEDING_MESSAGE', error], context).then(function (translations) {
                $rootScope.$broadcast('modal-error:show',
                    translations['PERMISSIONS_FAILURE_PRECEDING_MESSAGE'] + ' ' + translations[error]);
            });
        }

        function permissionSaveSuccess() {
            $scope.saving = false;
            $rootScope.$broadcast('change-directory');
            vm.hide();
        }

        function displayPermissionUpdateError(localizedError, action, response) {
            if (localizedError != null) {
                $translate([localizedError.errorName, action], localizedError.context).then(function (translations) {
                    vm.permissionSaveError(translations[localizedError.errorName], {action: translations[action]});
                }, function () {
                    vm.permissionSaveError(parseErrorResponse(response, action), {action: action});
                });
            } else {
                $translate(action).then(function (translatedAction) {
                    vm.permissionSaveError(parseErrorResponse(response, translatedAction), {action: translatedAction});
                }, function () {
                    vm.permissionSaveError(parseErrorResponse(response, action), {action: action});
                });

            }
        }

        function initiatePermissionsSave() {
            var filesSaved = 0, mode = permissionsFactory.objectToNumeric($scope.permissions);

            var checkCompleted = function () {
                ++filesSaved;

                if (filesSaved == $scope.filePaths.length)
                    vm.permissionSaveSuccess();
            };

            $scope.saving = true;

            $scope.filePaths.map(function (path) {
                connectionFactory.changePermissions(path, mode).then(function () {
                    checkCompleted();
                }, function (response) {
                    var action = "CHANGE_PERMISSIONS_OPERATION";

                    var localizedError = getLocalizedErrorFromResponse(response);

                    if(localizedError.context.operation == undefined)
                        localizedError.context.operation = action;

                    $translate(localizedError.context.operation).then(function (translatedAction) {
                        localizedError.context.operation = translatedAction;
                        displayPermissionUpdateError(localizedError, translatedAction, response);
                    }, function () {
                        displayPermissionUpdateError(localizedError, action, response);
                    });
                });
            });
        }
    }
}());
(function () {
    angular.module('MonstaFTP').controller('ModalPromptController', ModalPromptController);

    ModalPromptController.$inject = ['$scope', 'jQuery', '$translate'];

    function ModalPromptController($scope, jQuery, $translate) {
        var modalPromptId = '#modal-prompt', vm = this;

        this.setVars = function (title, initial, placeHolder) {
            $translate(title).then(function (translatedTitle) {
                $scope.title = translatedTitle;
            }, function () {
                $scope.title = title;
            });

            $translate(placeHolder).then(function (translatedPlaceholder) {
                $scope.placeHolder = translatedPlaceholder;
            }, function () {
                $scope.placeHolder = placeHolder;
            });

            $scope.initial = initial;
            $scope.final = initial;
            $scope.errorSet = false;
            $scope.errorMessage = '';
            $scope.isBusy = false;
            $scope.busyMessage = null;
            this.updateDismissMessage();
        };

        this.updateDismissMessage = function () {
            $translate($scope.busyMessage || 'DISMISS_OK_ACTION').then(function (translatedDismissMessage) {
                $scope.dismissMessage = translatedDismissMessage;
            }, function (dismissMessage) {
                $scope.dismissMessage = dismissMessage;
            });
        };

        jQuery(modalPromptId).on('shown.bs.modal', function () {
            jQuery(this).find('input[type=text]').focus();
        });

        this.setVars('', '', '');

        this.successCallback = function () {
            // empty
        };

        $scope.successClose = function () {
            vm.successCallback($scope.final, $scope.initial);
        };

        $scope.handlePromptKeypress = function ($event) {
            if ($event.which == 13)
                $scope.successClose();
        };

        this.show = function () {
            jQuery(modalPromptId).modal('show');
            vm.clearError();
            vm.clearBusy();
        };

        this.hide = function () {
            jQuery(modalPromptId).modal('hide');
        };

        this.clearError = function () {
            $scope.errorSet = false;
            $scope.errorMessage = '';
        };

        this.setBusy = function (busyMessage) {
            $scope.isBusy = true;
            $scope.busyMessage = busyMessage;
            this.updateDismissMessage();
        };

        this.clearBusy = function () {
            $scope.isBusy = false;
            $scope.busyMessage = null;
            this.updateDismissMessage();
        };

        $scope.$on('modal-prompt:show', function (ev, title, initial, placeHolder, successCallback) {
            vm.setVars(title, initial, placeHolder);
            vm.successCallback = successCallback;
            vm.show();
        });

        $scope.$on('modal-prompt:set-error', function (ev, errorMessage) {
            $scope.errorSet = true;

            $translate(errorMessage).then(function (translatedErrorMessage) {
                $scope.errorMessage = translatedErrorMessage;
            }, function () {
                $scope.errorMessage = errorMessage;
            });
        });

        $scope.$on('modal-prompt:clear-error', function () {
            vm.clearError();
        });

        $scope.$on('modal-prompt:hide', function () {
            vm.hide();
        });

        $scope.$on('modal-prompt:set-busy', function (ev, busyMessage) {
            vm.setBusy(busyMessage);
        });

        $scope.$on('modal-prompt:clear-busy', function () {
            vm.clearBusy();
        });
    }
}());
(function(){
    angular.module('MonstaFTP').controller('ModalSettingsController', ModalSettingsController);

    ModalSettingsController.$inject = ['jQuery', '$scope', 'configurationFactory', '$rootScope', '$translate',
        'localConfigurationFactory'];

    function ModalSettingsController(jQuery, $scope, configurationFactory, $rootScope, $translate,
                                     localConfigurationFactory) {
        var modalId = '#modal-settings', vm = this, applicationSettingsKeys = [], previousShowDotFiles;
        vm.applicationSettings = {};
        vm.show = show;
        vm.saveSettings = saveSettings;
        vm.debug = DEBUG;
        vm.systemShowDotFiles = false;
        vm.languageFiles = g_languageFiles;

        configurationFactory.getSystemConfiguration().then(systemVarLoadSuccess, systemVarLoadFailure);

        $scope.$on('modal-settings:show', function () {
            localConfigurationFactory.getApplicationSettings().then(function(){
                for (var i = 0; i < applicationSettingsKeys.length; ++i) {
                    var key = applicationSettingsKeys[i];
                    vm.applicationSettings[key] = localConfigurationFactory.getConfigurationItem(key);
                }
                vm.show();
            }, systemVarLoadFailure);
        });

        function show() {
            previousShowDotFiles = vm.applicationSettings.showDotFiles;
            jQuery(modalId).modal('show');
        }

        function hide() {
            jQuery(modalId).modal('hide');
        }

        function systemVarLoadSuccess(vars) {
            vm.systemShowDotFiles = vars.applicationSettings.showDotFiles;
            applicationSettingsKeys = Object.keys(vars.applicationSettings);
        }

        function systemVarLoadFailure(response) {
            showResponseError(response, "SYSTEM_VAR_LOAD_OPERATION", $rootScope, $translate);
        }
        
        function saveSettings() {
            for(var key in vm.applicationSettings){
                if (vm.applicationSettings.hasOwnProperty(key))
                    localConfigurationFactory.setConfigurationItem(key, vm.applicationSettings[key]);
            }

            hide();
        }

        $rootScope.$on('configuration:key-changed', function (ev, key, value) {
            if(key === 'language') {
                $translate.use(value);
            }
        });
    }
}());
(function () {
    var TRANSFER_UI_UPDATE_DELAY = 200;  // only update the UI after this many MS

    angular.module('MonstaFTP').controller('ModalTransferController', ModalTransferController);

    ModalTransferController.$inject = ['uploadFactory', '$rootScope', '$scope', 'jQuery', '$timeout',
        '$filter', 'uiOperationFactory'];

    function ModalTransferController(uploadFactory, $rootScope, $scope, jQuery, $timeout, $filter,
                                     uiOperationFactory) {
        var modalId = '#modal-transfers', vm = this, updateApplyTimeout = null, shown = false,
            shouldRefreshAfterHide = false;

        vm.updateUploads = updateUploads;
        vm.uploadFinished = uploadFinished;
        vm.show = show;
        vm.hide = hide;
        vm.abortItem = abortItem;
        vm.abortAll = abortAll;
        vm.remotePathToRelative = remotePathToRelative;
        vm.uploadAdded = uploadAdded;
        vm.fsFilter = $filter('file_size');

        vm.uploads = [];
        vm.itemToAbort = null;
        vm.currentUploadNumber = 1;
        vm.completedUploadTotal = 0;
        uploadFactory.updateCallback = vm.updateUploads;

        $scope.$on('upload:load', vm.uploadFinished);
        $scope.$on('upload:add', vm.uploadAdded);
        $scope.$on('upload:update', function(e, isExtractChange){
            shouldRefreshAfterHide = shouldRefreshAfterHide || isExtractChange;
            vm.updateUploads();
        });

        vm.remainingFilesMessage = '';

        function updateUploads(instantUpdate) {
            var uploads = angular.copy(uploadFactory.getUploads());

            if (uploads.length == 0) {
                updateApplyTimeout = null;
                $timeout(vm.hide, TRANSFER_COMPLETE_MODAL_HIDE_DELAY);
            } else {
                var timeout = instantUpdate ? 0 : TRANSFER_UI_UPDATE_DELAY;

                if (instantUpdate && updateApplyTimeout != null) {
                    clearTimeout(updateApplyTimeout);
                    updateApplyTimeout = null;
                }

                if (updateApplyTimeout == null) {
                    vm.uploads = uploads;
                    updateApplyTimeout = $timeout(function () {
                        $scope.$apply();
                        updateApplyTimeout = null;
                    }, timeout);
                }
            }
        }

        function uploadFinished(ev, success) {
            if (success) {
                vm.currentUploadNumber = Math.min(vm.currentUploadNumber + 1, vm.completedUploadTotal);
                shouldRefreshAfterHide = true;
            } else {
                --vm.completedUploadTotal;

                if (vm.completedUploadTotal < 0)
                    vm.completedUploadTotal = 0;
            }

            vm.updateUploads();
        }

        function show() {
            if (!shown) {
                jQuery(modalId).modal('show');
                shown = true;
            }
        }

        jQuery(modalId).on('hidden.bs.modal', function () {
            vm.uploads = [];
            vm.currentUploadNumber = 1;
            shouldRefreshAfterHide = false;
        });

        function hide() {
            if (shouldRefreshAfterHide)
                $rootScope.$broadcast('change-directory'); // refresh directory

            jQuery(modalId).modal('hide');
            shown = false;
        }

        function abortItem(item) {
            uploadFactory.abortItem(item);
            vm.updateUploads();
        }

        function abortAll() {
            uploadFactory.abortAll();
        }

        function remotePathToRelative(path) {
            var currentDirectory = uiOperationFactory.currentDirectory;

            if (currentDirectory.substr(currentDirectory.length - 1) != "/")
                currentDirectory += "/";

            var lengthModifier = 0;

            if (path.substr(0, 1) == "/") {
                path = path.substr(1);
                lengthModifier = 1;
            }

            return path.substr(currentDirectory.length - lengthModifier);
        }

        function uploadAdded() {
            vm.completedUploadTotal = uploadFactory.getUploads().length;
            vm.updateUploads();
            show();
        }
    }
}());
(function () {
    angular.module('MonstaFTP').directive('uploadProgressBar', uploadProgressBar);

    uploadProgressBar.$inject = ['transfer_percentFilter'];

    function uploadProgressBar(transfer_percentFilter) {
        function getProgressBarHtml(transfer) {
            var indeterminateClasses = '';

            if (transfer.stats.completedItems == transfer.stats.totalItems)
                indeterminateClasses = ' progress-bar-striped';

            if(!transfer.hasError)
                indeterminateClasses += ' active';

            var transferPercent = transfer_percentFilter(transfer);

            return '<div class="progress-bar progress-bar-success' + indeterminateClasses + '" ' +
                'role="progressbar" aria-valuenow="' + transferPercent + '" ' +
                'aria-valuemin="0" aria-valuemax="100" style="width: ' + transferPercent + '%;"></div>';
        }

        return {
            restrict: 'E',
            scope: {
                transfer: '='
            },
            template: '<div></div>',
            link: function ($scope, element, attrs) {
                var updatePBarHtml = function () {
                    element.html(getProgressBarHtml($scope.transfer));
                };

                updatePBarHtml();

                $scope.$watch('transfer.stats', function () {
                    updatePBarHtml();
                }, true);

                $scope.$watch('transfer.archiveExtractCurrent', function () {
                    updatePBarHtml();
                }, true);
            }
        };
    }
}());
(function(){
    angular.module('MonstaFTP').controller('ModalPropertiesController', ModalPropertiesController);

    ModalPropertiesController.$inject = ['jQuery', '$scope'];

    function ModalPropertiesController(jQuery, $scope) {
        var vm = this, modalPropertiesId = "#modal-properties";
        vm.item = null;

        vm.hide = hide;
        vm.show = show;

        $scope.$on('modal-properties:show', function (ev, item) {
           vm.show(item);
        });

        function hide() {
            jQuery(modalPropertiesId).modal('hide');
        }

        function show(item){
            vm.item = item;
            jQuery(modalPropertiesId).modal('show');
        }
    }
}());
function getMFP() {
    try {
        return [
            navigator.userAgent,
            [screen.height, screen.width, screen.colorDepth].join("x"),
            ( new Date() ).getTimezoneOffset(),
            !!window.sessionStorage,
            !!window.localStorage,
            $.map(navigator.plugins, function (p) {
                return [
                    p.name,
                    p.description,
                    $.map(p, function (mt) {
                        return [mt.type, mt.suffixes].join("~");
                    }).join(",")
                ].join("::");
            }).join(";")
        ].join("###").hashCode();
    } catch (e) {
        return null;
    }
}

function getMUuid() {
    var uuidKey = "mftp-uuid";
    try {
        var uuidVal = localStorage.getItem(uuidKey);
        if (uuidVal == null) {
            uuidVal = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
            localStorage.setItem(uuidKey, uuidVal);
        }
        return uuidVal.replace(/-/g, '');
    } catch (e) {
        return getMFP();
    }
}

function getFpQs() {
    var mUuid = getMUuid();
    return mUuid == null ? '' : '&amp;fp=' + mUuid;
}

String.prototype.hashCode = function() {
    var hash = 0, i, chr;
    if (this.length === 0) return hash;
    for (i = 0; i < this.length; i++) {
        chr   = this.charCodeAt(i);
        hash  = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
};
(function () {
    angular.module('MonstaFTP').factory('permissionsFactory', permissionsFactory);

    function permissionsFactory() {
        return {
            objectToNumeric: function (permissions) {
                return (permissions.ownerRead ? 0x100 : 0) + (permissions.ownerWrite ? 0x80 : 0) +
                    (permissions.ownerExecute ? 0x40 : 0) + (permissions.groupRead ? 0x20 : 0) +
                    (permissions.groupWrite ? 0x10 : 0) + (permissions.groupExecute ? 0x8 : 0) +
                    (permissions.otherRead ? 0x4 : 0) + (permissions.otherWrite ? 0x2 : 0) +
                    (permissions.otherExecute ? 0x1 : 0);
            },
            numericToObject: function (numericPermission) {
                return {
                    ownerRead: (numericPermission & 0x100) != 0,
                    ownerWrite: (numericPermission & 0x80) != 0,
                    ownerExecute: (numericPermission & 0x40) != 0,
                    groupRead: (numericPermission & 0x20) != 0,
                    groupWrite: (numericPermission & 0x10) != 0,
                    groupExecute: (numericPermission & 0x8) != 0,
                    otherRead: (numericPermission & 0x4) != 0,
                    otherWrite: (numericPermission & 0x2) != 0,
                    otherExecute: (numericPermission & 0x1) != 0
                };
            }
        }
    }
}());


function rot13(s) {
    return s.replace(/[a-zA-Z]/g, function (c) {
        return String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
    });
}
(function () {
    angular.module('MonstaFTP').controller('SlidebarController', SlidebarController);

    SlidebarController.$inject = ['$scope', 'authenticationFactory', '$rootScope', 'jQuery', '$translate',
        'configurationFactory', 'licenseFactory'];

    function SlidebarController($scope, authenticationFactory, $rootScope, jQuery, $translate, configurationFactory,
                                licenseFactory) {
        var vm = this, sbController = null, allSlidebarItems = [
            'logout',
            'change-server',
            'settings',
            'addons',
            'help'
        ];

        vm.showHelpButton = true;
        vm.showAddOnsButton = true;
        vm.showChangeServerButton = true;
        vm.customHelpUrl = null;
        vm.itemDisplay = {};

        jQuery('#slidebar').ready(function () {
            sbController = new slidebars();
            sbController.init();
        });

        jQuery("#slidebar-toggle").click(function () {
            if (sbController != null)
                sbController.toggle("slidebar")
        });

        vm.confirmLogout = confirmLogout;
        vm.initiateLogout = initiateLogout;
        vm.showAddonsModal = showAddonsModal;
        vm.showSettingsModal = showSettingsModal;
        vm.showLoginPanel = showLoginPanel;
        vm.itemHidden = itemHidden;

        $scope.$on('license-loaded', function () {
            if (licenseFactory.isLicensed()) {
                configurationFactory.getSystemConfiguration().then(function () {
                    vm.showHelpButton = !configurationFactory.getApplicationSetting('disableHelpButton');
                    vm.showAddOnsButton = !configurationFactory.getApplicationSetting('disableAddOnsButton');
                    vm.customHelpUrl = configurationFactory.getApplicationSetting('helpUrl');
                    vm.showChangeServerButton =
                        !configurationFactory.getApplicationSetting('disableChangeServerButton');

                    vm.itemDisplay = configurationFactory.getApplicationSetting('sidebarItemDisplay') || {};
                    updateSlidebarDisplay();
                }, function () {
                });
            }
        });

        $scope.$on('file-editor:will-show', function () {
            slideBarClose();
        });

        function slideBarClose() {
            if (sbController != null)
                sbController.close("slidebar");
        }

        function confirmLogout() {
            slideBarClose();
            authenticationFactory.logout();
            $rootScope.$broadcast('logout');
        }

        function showModalConfirm(translatedMessage) {
            slideBarClose();
            $rootScope.$broadcast('modal-confirm:show', translatedMessage, vm.confirmLogout);
        }

        function initiateLogout() {
            slideBarClose();
            $translate('LOGOUT_CONFIRM_MESSAGE').then(showModalConfirm, showModalConfirm);
        }

        function showAddonsModal() {
            slideBarClose();
            $rootScope.$broadcast('modal-addons:show');
        }

        function showSettingsModal() {
            slideBarClose();
            $rootScope.$broadcast('modal-settings:show');
        }

        function showLoginPanel() {
            slideBarClose();
            $rootScope.$broadcast('modal-login:show');
        }

        function itemHidden(itemId) {
            if (!vm.itemDisplay.hasOwnProperty(itemId))
                return false;

            return vm.itemDisplay[itemId] === false;
        }

        function updateSlidebarDisplay() {
            var shouldHide = allInterfaceOptionsDisabled(allSlidebarItems, vm.itemDisplay);

            var body = document.getElementsByTagName('body')[0];

            if (shouldHide)
                body.classList.add("no-slidebar");
            else
                body.classList.remove("no-slidebar");
        }
    }
}());


(function () {
    angular.module('MonstaFTP').controller('SpinnerController', SpinnerController);

    SpinnerController.$inject = ['$scope'];

    function SpinnerController($scope) {
        $scope.spinnerVisible = false;

        $scope.$on('request-count-change', function (ev, reqCount) {
            $scope.spinnerVisible = reqCount != 0;
        });
    }
}());

(function () {
    angular.module('MonstaFTP').factory('uiOperationFactory', uiOperationFactory);

    uiOperationFactory.$inject = ['$rootScope'];

    function uiOperationFactory($rootScope) {
        return {
            cutSource: null,
            copySource: null,
            currentDirectory: "",
            setCutSource: function (newCutSource) {
                this.cutSource = newCutSource;
                this.copySource = null;

                if (newCutSource != null)
                    $rootScope.$broadcast('paste-source:set');
            },
            setCopySource: function (newCopySource) {
                this.copySource = newCopySource;
                this.cutSource = null;

                if (newCopySource != null)
                    $rootScope.$broadcast('paste-source:set');
            },
            pasteComplete: function () {
                if (this.cutSource != null)
                    $rootScope.$broadcast('paste-source:cleared');
                this.cutSource = null;
            },
            clearCutAndCopySource: function () {
                this.copySource = null;
                this.cutSource = null;
                $rootScope.$broadcast('paste-source:cleared');
            },
            isCutOrCopySource: function (path) {
                return path == this.copySource || path == this.cutSource;
            },
            joinNameToCurrentDirectory: function (name) {
                return pathJoin(this.currentDirectory, name);
            }
        };
    }
}());
(function () {
    angular.module('MonstaFTP').factory('requestLoginFactory', requestLoginFactory);

    requestLoginFactory.$inject = ["$location"];

    function requestLoginFactory($location) {
        var factory = {};

        factory.encodeConfiguration = encodeConfiguration;
        factory.decodeConfiguration = decodeConfiguration;
        factory.getPreHashURL = getPreHashURL;
        factory.getConfigURL = getConfigURL;
        factory.compactConfigKeys = compactConfigKeys;
        factory.uncompactConfigKeys = uncompactConfigKeys;
        factory.decodePostHash = decodePostHash;
        factory.getConfigFromCurrentURL = getConfigFromCurrentURL;
        factory.getFormFieldHTML = getFormFieldHTML;

        function encodeConfiguration(type, configuration) {
            if (typeof configuration.name != "undefined")
                delete configuration.name;

            var configDict = {
                t: type,
                c: factory.compactConfigKeys(configuration)
            };
            return encodeURIComponent(b64EncodeUnicode(JSON.stringify(configDict)));
        }

        function decodeConfiguration(encodedConfiguration) {
            var configDict = JSON.parse(b64DecodeUnicode(decodeURIComponent(encodedConfiguration)));

            return {
                type: configDict.t,
                configuration: factory.uncompactConfigKeys(configDict.c)
            };
        }

        function decodePostHash(postHash) {
            if (isEmpty(postHash))
                return null;

            if (postHash.substr(0, 1) == "/")
                postHash = postHash.substr(1);

            var splitURL = postHash.split("/");

            if (splitURL.length < 4 || splitURL[0] != 'c')
                return null;

            var host = splitURL[1], username = splitURL[2], config = splitURL[3], decodedConfiguration = null;

            try {
                decodedConfiguration = factory.decodeConfiguration(config);
            } catch (e) {
                return null;
            }

            if (host != "_")
                decodedConfiguration.configuration.host = host;

            if (username != "_") {
                var usernameKey = decodedConfiguration.type == 'sftp' ? 'remoteUsername' : 'username';

                decodedConfiguration.configuration[usernameKey] = username;
            }

            return decodedConfiguration;
        }

        function getPreHashURL() {
            var absURL = $location.absUrl();
            var splitURL = absURL.split('#');
            return splitURL[0];
        }

        function getConfigURL(type, configuration) {
            if(configuration == null)
                return null;

            configuration = angular.copy(configuration);
            var host = null, username = null;

            if (configuration.hasOwnProperty('host')) {
                host = configuration.host;
                delete configuration.host;
            }

            var usernameKey = type == 'sftp' ? 'remoteUsername' : 'username';

            if (configuration.hasOwnProperty(usernameKey)) {
                username = configuration[usernameKey];
                delete configuration[usernameKey];
            }

            if (isEmpty(host))
                host = '_';
            else
                host = encodeURIComponent(host);

            if (isEmpty(username))
                username = '_';
            else
                username = encodeURIComponent(username);

            var postHash = '/c/' + host + '/' + username + '/' + factory.encodeConfiguration(type, configuration);

            return factory.getPreHashURL() + "#" + postHash;
        }

        function getConfigFromCurrentURL() {
            var absURL = $location.absUrl();
            var splitURL = absURL.split('#');
            if(splitURL.length == 1)
                return null;

            return decodePostHash(splitURL[1]);
        }

        function getTransformLookup(isCompact) {
            var compactLookup = [
                ["passive", "v"],
                ["ssl", "s"],
                ["password", "p"],
                ["initialDirectory", "i"],
                ["port", "o"],
                ["authenticationModeName", "m"],
                ["privateKeyFilePath", "r"],
                ["publicKeyFilePath", "q"]
            ];

            var to = isCompact ? 1 : 0;
            var from = isCompact ? 0 : 1;

            var transformLookup = {};

            for (var i = 0; i < compactLookup.length; ++i) {
                transformLookup[compactLookup[i][from]] = compactLookup[i][to];
            }

            return transformLookup;
        }

        function compactAndUncompact(isCompact, toTransform) {
            var transformResult = {};

            var transformLookup = getTransformLookup(isCompact);

            for (var key in toTransform) {
                if (!toTransform.hasOwnProperty(key))
                    continue;

                var value = toTransform[key];

                if (transformLookup.hasOwnProperty(key))
                    key = transformLookup[key];

                if (isCompact) {
                    if (value === true)
                        value = 1;
                    else if (value === false)
                        value = 0;
                } else {
                    if (value === 1)
                        value = true;
                    if (value === 0)
                        value = false;
                }

                transformResult[key] = value;
            }

            return transformResult;
        }

        function compactConfigKeys(config) {
            return compactAndUncompact(true, config);
        }

        function uncompactConfigKeys(config) {
            return compactAndUncompact(false, config);
        }

        function getFormFieldHTML(name, value) {
            var entityMap = {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': '&quot;'
            };

            value = String(value).replace(/[&<>"]/g, function (s) {
                return entityMap[s];
            });

            return '<input type="hidden" name="'+ name +'" value="' + value + '">'
        }

        return factory;
    }
}());
(function () {
    angular.module('MonstaFTP').factory('uploadFactory', uploadFactory);

    uploadFactory.$inject = ['connectionFactory', '$rootScope', '$translate'];

    function uploadFactory(connectionFactory, $rootScope, $translate) {
        var EXTRACT_PROGRESS_STEPS = 10000; // maximum number of files to try to upload during extract in one step

        return {
            updateCallback: null,
            _uploads: [],
            _activeUploadCount: 0,
            addUpload: function (name, remotePath, fileObject, size, isArchive) {
                if (MAX_UPLOAD_BYTES != -1 && size > MAX_UPLOAD_BYTES)
                    return false;

                this._uploads.push({
                    name: name,
                    remotePath: remotePath,
                    file: fileObject,
                    request: null,
                    stats: new TransferStats(size),
                    hasError: false,
                    isArchive: isArchive,
                    archiveExtractMax: 0,
                    archiveExtractCurrent: -1,
                    sessionKey: null,
                    isAngularRequest: false
                });
                $rootScope.$broadcast('upload:add');
                if (this._activeUploadCount < MAX_CONCURRENT_UPLOADS)
                    this.startUploadOfItemAtIndex(this._uploads.length - 1);

                return true;
            },
            addExtract: function (name, fileKey, fileCount) {
                // file is already on the server, just trigger the extract
                var stats = new TransferStats(1);
                stats.transferType = 'extract';
                stats.complete();

                var uploadItem = {
                    name: name,
                    localRelativePath: null,
                    remotePath: null,
                    file: null,
                    request: null,
                    stats: stats,
                    hasError: false,
                    isArchive: true,
                    archiveExtractMax: fileCount,
                    archiveExtractCurrent: 0,
                    sessionKey: null,
                    forceComplete: true,
                    isAngularRequest: false
                };

                this._uploads.push(uploadItem);

                this.progressExtract(fileKey, uploadItem, fileCount, 0);
                $rootScope.$broadcast('upload:add');
            },
            startNextItem: function () {
                if (this._activeUploadCount >= MAX_CONCURRENT_UPLOADS)
                    return;

                for (var itemIndex = 0; itemIndex < this._uploads.length; ++itemIndex) {
                    if (this._uploads[itemIndex].stats.hasBeenStarted())
                        continue;

                    this.startUploadOfItemAtIndex(itemIndex);
                    break;
                }
            },
            getUploads: function () {
                return this._uploads;
            },
            getUploadItem: function (itemIndex) {
                return this._uploads[itemIndex];
            },
            progressItem: function (uploadItem, transferredBytes) {
                if (uploadItem.stats.updateTransferAmount(transferredBytes) && this.updateCallback != null)
                    this.updateCallback();
            },
            getUploadRequestBody: function (remotePath, isArchive) {
                var requestBody = connectionFactory.getRequestBody();
                requestBody.actionName = isArchive ? UPLOAD_ARCHIVE_ACTION : UPLOAD_ACTION;

                requestBody.context = {
                    remotePath: remotePath
                };

                return requestBody;
            },
            encodeRequestBody: function (requestBody) {
                var jsonRequestBody = JSON.stringify(requestBody);

                return b64EncodeUnicode(jsonRequestBody);
            },
            getXHR: function () {
                return new XMLHttpRequest();
            },
            startXHR: function (request, requestBody, file) {
                ++this._activeUploadCount;
                request.open('POST', UPLOAD_PATH);
                request.setRequestHeader("X-Monsta", this.encodeRequestBody(requestBody));
                request.setRequestHeader("Content-Type", "application/octet-stream");
                request.send(file);
                if (this.updateCallback != null)
                    this.updateCallback(true);
            },
            startMultiStageUploadXHR: function (request, sessionKey, file) {
                request.open('POST', MULTI_STAGE_UPLOAD_PATH + "?sessionKey=" + sessionKey);
                request.setRequestHeader("Content-Type", "application/octet-stream");
                request.send(file);
                if (this.updateCallback != null)
                    this.updateCallback(true);
            },
            addEventProgressListenersToRequest: function (request, fileRequestDescription, itemIndex) {
                var _this = this;

                request.upload.addEventListener("progress", function (e) {
                    if (request.readyState == XMLHttpRequest.OPENED)
                        _this.progressItem(fileRequestDescription, e.lengthComputable ? e.loaded : null);
                }, false);

                request.upload.addEventListener('load', function () {
                    fileRequestDescription.stats.completedItems = fileRequestDescription.stats.totalItems;
                    if (_this.updateCallback != null)
                        _this.updateCallback();
                }, false);

                request.onreadystatechange = function () {
                    if (request.readyState === XMLHttpRequest.DONE) {
                        if (request.status === 200) {
                            if (FEATURE_MULTI_STAGE_UPLOAD)
                                _this.transferItemAtIndexToRemote(itemIndex);
                            else
                                _this.completeItem(fileRequestDescription, request.responseText, false, true);
                        } else if (request.status !== 0) { // is zero on abort
                            safeConsoleError(request);

                            _this.setItemError(fileRequestDescription, request.status, request.statusText);
                        }
                    }
                };
            },
            startStandardUploadOfItemAtIndex: function (itemIndex) {
                var fileRequestDescription = this._uploads[itemIndex];
                var request = this.getXHR();
                fileRequestDescription.request = request;

                var requestBody = this.getUploadRequestBody(fileRequestDescription.remotePath,
                    fileRequestDescription.isArchive);

                this.addEventProgressListenersToRequest(request, fileRequestDescription, itemIndex);

                this.startXHR(request, requestBody, fileRequestDescription.file);
                fileRequestDescription.stats.wasStarted();
            }, startMultiStageUploadOfItemAtIndex: function (itemIndex, sessionKey) {
                var fileRequestDescription = this._uploads[itemIndex];
                var request = this.getXHR();
                fileRequestDescription.request = request;
                fileRequestDescription.sessionKey = sessionKey;

                this.addEventProgressListenersToRequest(request, fileRequestDescription, itemIndex);

                this.startMultiStageUploadXHR(request, sessionKey, fileRequestDescription.file);
                fileRequestDescription.stats.wasStarted();
            }, startUploadOfItemAtIndex: function (itemIndex) {
                if (FEATURE_MULTI_STAGE_UPLOAD) {
                    ++this._activeUploadCount;
                    var _this = this;
                    var fileRequestDescription = this._uploads[itemIndex];
                    connectionFactory.reserveUploadContext(UPLOAD_ACTION, fileRequestDescription.remotePath).then(
                        function (response) {
                            if (responseIsUnsuccessful(response)) {
                                showResponseError(response, "UPLOAD_OPERATION", $rootScope, $translate);
                                return;
                            }

                            _this.startMultiStageUploadOfItemAtIndex(itemIndex, response.data.data);
                        }, function (response) {
                            showResponseError(response, "UPLOAD_OPERATION", $rootScope, $translate);
                        });
                } else {
                    this.startStandardUploadOfItemAtIndex(itemIndex);
                }
            }, handleExtractProgressErrorResponse: function (response, uploadItem, fileKey) {
                uploadItem.request = null;

                if (uploadItem.shouldAbort) {
                    connectionFactory.cleanUpExtract(fileKey);
                } else {
                    showResponseError(response, "EXTRACT_ARCHIVE_OPERATION", $rootScope, $translate);
                }

                $rootScope.$broadcast('upload:update', true);

                this.completeItem(uploadItem, null, true, false);
            }, handleExtractProgressSuccessResponse: function (response, uploadItem, fileKey, fileCount, fileOffset) {
                if (response.data.errors !== undefined) {
                    // is actually an error but due to pushing characters to keep connection alive, 200 status
                    // code was returned, so we're here
                    this.handleExtractProgressErrorResponse(response, uploadItem, fileKey);
                    return;
                }

                uploadItem.request = null;
                var isFinalTransfer = response.data.data[0], itemsTransferred = response.data.data[1];

                uploadItem.archiveExtractCurrent = Math.min(fileOffset + itemsTransferred, fileCount);

                uploadItem.stats.updateTransferAmount(uploadItem.archiveExtractCurrent);

                $rootScope.$broadcast('upload:update', true);

                if (isFinalTransfer) {
                    this.completeItem(uploadItem, null, true, true);
                } else if (uploadItem.shouldAbort === true) {
                    connectionFactory.cleanUpExtract(fileKey);
                } else {
                    this.progressExtract(fileKey, uploadItem, fileCount, fileOffset + itemsTransferred);
                }
            }, progressExtract: function (fileKey, uploadItem, fileCount, fileOffset) {
                var _this = this;
                var uploadRequest = connectionFactory.extractArchive(fileKey, fileOffset, EXTRACT_PROGRESS_STEPS);

                uploadItem.request = uploadRequest;
                uploadItem.isAngularRequest = true;

                $rootScope.$broadcast('upload:update');

                uploadRequest.promise.then(function (response) {
                    _this.handleExtractProgressSuccessResponse(response, uploadItem, fileKey, fileCount, fileOffset);
                }, function (response) {
                    _this.handleExtractProgressErrorResponse(response, uploadItem, fileKey);
                });
            },
            transferItemAtIndexToRemote: function (itemIndex) {
                var fileRequestDescription = this._uploads[itemIndex], _this = this;

                connectionFactory.transferUploadToRemote(fileRequestDescription.sessionKey).then(function (response) {
                    if (responseIsUnsuccessful(response)) {
                        showResponseError(response, "UPLOAD_OPERATION", $rootScope, $translate);
                        return;
                    }

                    _this.completeItem(fileRequestDescription, null, false, true);
                }, function (response) {
                    showResponseError(response, "UPLOAD_OPERATION", $rootScope, $translate);
                    _this.completeItem(fileRequestDescription, null, false, false);
                });
            },
            completeItem: function (uploadItem, responseText, isPostExtract, success) {
                var _this = this;
                if (uploadItem.isArchive && !isPostExtract) {
                    var responseData = JSON.parse(responseText);
                    uploadItem.archiveExtractCurrent = 0;
                    uploadItem.archiveExtractMax = responseData.fileCount;
                    uploadItem.stats = new TransferStats(responseData.fileCount);
                    uploadItem.stats.transferType = "extract";
                    this.progressExtract(responseData.fileKey, uploadItem, responseData.fileCount, 0);
                } else {
                    --this._activeUploadCount;
                    uploadItem.request = null;
                    uploadItem.stats.complete();
                    this.removeItem(uploadItem);

                    setTimeout(function () {
                        _this.broadcastComplete.call(_this, success);
                    }, 0);
                }

                $rootScope.$broadcast('upload:update');
            }, broadcastComplete: function (success) {
                $rootScope.$broadcast('upload:load', success);
                this.startNextItem();
                if (this.updateCallback != null)
                    this.updateCallback(true);
            },
            abortItemUploadRequest: function (uploadItem) {
                if (!uploadItem.isArchive && uploadItem.request != null) {
                    uploadItem.request.abort();
                    uploadItem.request = null;
                }

                if (uploadItem.isArchive) {
                    uploadItem.shouldAbort = true;

                    if (uploadItem.request != null) {
                        if (uploadItem.isAngularRequest)
                            uploadItem.request.cancel("aborted");
                        else
                            uploadItem.request.abort();

                        uploadItem.request = null;
                    }
                }
            },
            abortItem: function (uploadItem) {
                uploadItem = this.getOriginalUploadItem(uploadItem);

                --this._activeUploadCount;

                this.abortItemUploadRequest(uploadItem);

                this.removeItem(uploadItem);
                $rootScope.$broadcast('upload:abort');
                this.startNextItem();
            },
            removeItem: function (uploadItem) {
                this._uploadIterator(function (_itemIndex, _item) {
                    if (uploadItem.remotePath == _item.remotePath) {
                        if (_item.request != null)
                            return false;

                        this._uploads.splice(_itemIndex, 1);
                        return false;
                    }
                });
            },
            setItemError: function (uploadItem, statusCode, statusText) {
                uploadItem.hasError = true;
                uploadItem.statusCode = statusCode;
                uploadItem.statusText = statusText;
                if (uploadItem.request != null) {
                    uploadItem.request = null;
                    if (this.updateCallback != null)
                        this.updateCallback();
                }
            },
            _uploadIterator: function (callback) {
                for (var itemIndex = 0; itemIndex < this._uploads.length; ++itemIndex) {
                    if (callback.call(this, itemIndex, this._uploads[itemIndex]) === false)
                        break;
                }
            },
            abortAll: function () {
                for (var itemIndex = 0; itemIndex < this._uploads.length; ++itemIndex) {
                    var uploadItem = this._uploads[itemIndex];

                    this.abortItemUploadRequest(uploadItem);
                }
                this._uploads = [];
                this._activeUploadCount = 0;
                if (this.updateCallback != null)
                    this.updateCallback(true);
            },
            getOriginalUploadItem: function (uploadItem) {
                var originalItem = null;
                this._uploadIterator(function (_itemIndex, _item) {
                    if (uploadItem.remotePath == _item.remotePath) {
                        originalItem = _item;
                        return false;
                    }
                });

                return originalItem;
            }
        };
    }
}());
(function () {
    angular.module('MonstaFTP').factory('uploadUIFactory', uploadUIFactory);

    uploadUIFactory.$inject = ['uiOperationFactory', 'uploadFactory', '$filter', '$rootScope', '$translate'];

    function uploadUIFactory(uiOperationFactory, uploadFactory, $filter, $rootScope, $translate) {
        var sizeFilter = $filter('file_size'),
            NAME_INDEX = 0,
            REMOTE_PATH_INDEX = 1,
            FILE_INDEX = 2,
            SIZE_INDEX = 3,
            IS_ARCHIVE_INDEX = 4;

        function showErrorModal(message) {
            $rootScope.$broadcast('modal-error:show', message, function () {

            });
        }

        function showTooLargeFilesError(message, tooLargeFiles) {
            for (var fileIndex = 0; fileIndex < tooLargeFiles.length; ++fileIndex) {
                var fileData = tooLargeFiles[fileIndex];
                message += "<br>&nbsp;&nbsp;&nbsp;&nbsp;" + fileData[0] + " (" + sizeFilter(fileData[1]) + ")";
            }

            showErrorModal(message);
        }

        function broadcastExtractMessage(factory, $rootScope, message) {
            $rootScope.$broadcast("modal-choice:show", "EXTRACT_AFTER_UPLOAD_TITLE", message, function () {
                factory.filesToQueue.splice(factory.fileQueueIndex, 1);

                factory.processUploadQueue();
            }, [
                ["UPLOAD_STANDARD_ACTION", function () {
                    factory.uploadStandardCallback()
                }],
                ["UPLOAD_EXTRACT_ACTION", function () {
                    factory.uploadAndExtractCallback()
                }]
            ]);
        }

        return {
            tooLargeFiles: [],
            filesToQueue: [],
            fileQueueIndex: 0,
            treeTotalSize: 0,
            treeProcessed: 0,
            traverseFinished: false,
            uploadStandardCallback: function () {
                this.filesToQueue[this.fileQueueIndex][IS_ARCHIVE_INDEX] = false;
                this.processUploadQueue();
            },
            uploadAndExtractCallback: function () {
                this.filesToQueue[this.fileQueueIndex][IS_ARCHIVE_INDEX] = true;
                this.processUploadQueue();
            },
            promptForExtract: function (fileName) {
                var _this = this;
                $translate("EXTRACT_AFTER_UPLOAD_MESSAGE", {
                    file_name: "TAG_STRONG_START" + fileName + "TAG_STRONG_END",
                    file_type: "TAG_STRONG_START" + extractFileExtension(fileName) + "TAG_STRONG_END"
                }).then(function (translatedMessage) {
                    broadcastExtractMessage(_this, $rootScope, translatedMessage);
                }, function () {
                    broadcastExtractMessage(_this, $rootScope, "Extract " + fileName + " after uploading?");
                });
            },
            processUploadQueue: function () {
                if (this.fileQueueIndex >= this.filesToQueue.length) {
                    this.checkTooLargeFiles();
                    this.performUploads();
                    return;
                }

                var fileInfo = this.filesToQueue[this.fileQueueIndex];

                if (fileInfo[IS_ARCHIVE_INDEX] == null && isExtractSupported(fileInfo[NAME_INDEX]))
                    this.promptForExtract(fileInfo[NAME_INDEX]);
                else {
                    ++this.fileQueueIndex;
                    this.processUploadQueue();
                }
            },
            performUploads: function () {
                for (var i = 0; i < this.filesToQueue.length; ++i) {
                    var fileInfo = this.filesToQueue[i];
                    uploadFactory.addUpload(fileInfo[NAME_INDEX], fileInfo[REMOTE_PATH_INDEX], fileInfo[FILE_INDEX],
                        fileInfo[SIZE_INDEX], fileInfo[IS_ARCHIVE_INDEX]);
                }

                this.filesToQueue = [];
                this.fileQueueIndex = 0;
                this.tooLargeFiles = [];
            },
            checkTooLargeFiles: function () {
                if (this.tooLargeFiles.length != 0) {
                    var tLFCopy = this.tooLargeFiles.slice();
                    $translate('UPLOAD_FILES_TOO_LARGE_MESSAGE', {
                        item_count: this.tooLargeFiles.length,
                        maximum_size: sizeFilter(MAX_UPLOAD_BYTES)
                    }).then(function (translatedMessage) {
                        showTooLargeFilesError(translatedMessage, tLFCopy);
                    }, function (message) {
                        showTooLargeFilesError(message, tLFCopy);
                    });
                }
            },
            doUploadAdd: function (file, relativeFilePath, isArchive) {
                var remotePath = uiOperationFactory.joinNameToCurrentDirectory(relativeFilePath);

                if (file.size > MAX_UPLOAD_BYTES)
                    this.tooLargeFiles.push([relativeFilePath, file.size]);
                else
                    this.filesToQueue.push([file.name, remotePath, file, file.size, isArchive]);
            },
            traverseFileTree: function (item, path, isArchive) {
                path = path || "";
                var _this = this;
                if (item.isFile) {
                    ++_this.treeTotalSize;
                    item.file(function (file) {
                        ++_this.treeProcessed;
                        var relativeFilePath = pathJoin(path, item.name);
                        _this.doUploadAdd.call(_this, file, relativeFilePath, isArchive);
                        if (_this.traverseFinished && _this.treeProcessed == _this.treeTotalSize) {
                            _this.processUploadQueue();
                        }
                    });
                } else if (item.isDirectory) {
                    var dirReader = item.createReader();
                    dirReader.readEntries(function (entries) {
                        for (var entryIndex = 0; entryIndex < entries.length; ++entryIndex) {
                            _this.traverseFileTree.call(_this, entries[entryIndex], pathJoin(path, item.name),
                                isArchive);
                        }
                    });
                }
            },
            handleItemsBasedUpload: function (items, isArchive) {
                this.tooLargeFiles = [];
                this.filesToQueue = [];
                this.fileQueueIndex = 0;
                this.treeTotalSize = 0;
                this.treeProcessed = 0;
                this.traverseFinished = false;
                for (var itemIndex = 0; itemIndex < items.length; ++itemIndex) {
                    var item = items[itemIndex].webkitGetAsEntry();
                    if (item)
                        this.traverseFileTree(item, null, isArchive);
                }
                this.fileQueueIndex = 0;
                this.traverseFinished = true;
            },
            handleFilesBasedUpload: function (files, isArchive) {
                this.tooLargeFiles = [];
                this.filesToQueue = [];
                this.fileQueueIndex = 0;
                var checkedFilesCount = 0, _this = this;

                var handleFileCheckFinished = function () {
                    if (checkedFilesCount != files.length)
                        return;

                    for (fileIndex = 0; fileIndex < files.length; ++fileIndex) {
                        file = files[fileIndex];
                        var relativeFilePath = file.webkitRelativePath ? file.webkitRelativePath : file.name;
                        _this.doUploadAdd.call(_this, file, relativeFilePath, isArchive);
                    }
                    _this.processUploadQueue();
                };

                if (window.FileReader == undefined) {
                    // can't check if it's file or folder so just try to upload and hope for the best
                    checkedFilesCount = files.length;
                    handleFileCheckFinished();
                    return;
                }

                var loadSuccess = function () {
                    ++checkedFilesCount;
                    handleFileCheckFinished();
                };

                var showFolderUploadNotSupportedMessage = function () {
                    $translate('FOLDER_UPLOAD_NOT_SUPPORTED_MESSAGE').then(showErrorModal, showErrorModal);
                };

                if (files.length == 0) {
                    // happens for folder drag drop in IE
                    showFolderUploadNotSupportedMessage();
                    return;
                }

                var userAgent = window.navigator.userAgent;

                var isInternetExplorer = /trident/i.test(userAgent) || /msie/i.test(userAgent);

                for (var fileIndex = 0; fileIndex < files.length; ++fileIndex) {
                    if (isInternetExplorer) {
                        loadSuccess();  // if dropping a folder on IE files will be empty and we won't get here
                        continue
                    }

                    var file = files[fileIndex];

                    var reader = new FileReader();

                    reader.onerror = function (e) {
                        showFolderUploadNotSupportedMessage();
                    };

                    reader.onload = loadSuccess;
                    if (file.size <= MAX_UPLOAD_BYTES) {
                        // we won't be able to upload them anyway so don't bother reading
                        try {
                            var s = file.slice(0, Math.min(file.size, 1024));

                            if(s.size == 0)
                                reader.readAsBinaryString(file); // might be a directory depending on browser
                            else
                                reader.readAsBinaryString(s);
                        } catch (e) {

                        }
                    } else
                        loadSuccess();
                }
            }
        };
    }
}());
(function () {
    angular.module('MonstaFTP').filter('file_last_modified', filesLastModified);

    filesLastModified.$inject = ['dateFilter'];

    function filesLastModified(dateFilter) {
        function filter(input) {
            if (typeof(input) != 'number')
                return '';

            var inputDate = new Date(input * 1000);
            var currentDate = new Date();
            var format;

            if (inputDate.getDate() == currentDate.getDate() &&
                inputDate.getMonth() == currentDate.getMonth() &&
                inputDate.getFullYear() == currentDate.getFullYear())
                format = 'shortTime';
            else
                format = 'mediumDate';

            return dateFilter(inputDate, format)
        }

        return filter;
    }
}());
angular.module('MonstaFTP').filter('file_size', function () {
    return function (input) {
        if (input < 0)
            input = 0;

        return normalizeFileSize(input);
    };
});
angular.module('MonstaFTP').filter("html_safe", ['$sce', function($sce) {
    return function(htmlCode){
        return $sce.trustAsHtml(htmlCode);
    };
}]);
(function () {
    angular.module('MonstaFTP').filter('human_time_since', humanTimeSince);
    function humanTimeSince() {
        function timestampToFormattedDate(timeStamp, dmyFormat) {
            var d = new Date(timeStamp * 1000);
            if (dmyFormat === true)
                return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();

            return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
        }

        return function (input, dmyFormat) {
            if (typeof(input) != 'number')
                return '';

            var scaledTimeDelta, units,
                timeDiff = Date.now() / 1000 - input,
                timeSteps = [
                    [3540, 60, 'minute'], // 59 minutes
                    [82800, 3600, 'hour'], // 23 hours
                    [2592000, 86400, 'day'] // 30 days
                ];

            if (timeDiff < 0 || timeDiff > timeSteps[timeSteps.length - 1][0])
                return timestampToFormattedDate(input, dmyFormat);
            else if (timeDiff <= 60)
                return 'now';

            for (var i = 0; i < timeSteps.length; ++i) {
                if (timeDiff > timeSteps[i][0])
                    continue;

                scaledTimeDelta = Math.round(timeDiff / timeSteps[i][1]);
                units = timeSteps[i][2];
                break;
            }

            if (scaledTimeDelta != 1)
                units += 's';

            return scaledTimeDelta + ' ' + units + ' ago';
        }
    }
}());
angular.module('MonstaFTP').filter('icon', function () {
    return function (item) {
        if (item.isDirectory)
            return 'fa-folder';

        if (item.isLink)
            return 'fa-long-arrow-right';

        var iconName = '';

        switch (extractFileExtension(item.name)) {
            case 'doc':
            case 'docx':
                iconName = 'word';
                break;
            case 'xlr':
            case 'xls':
            case 'xlsx':
                iconName = 'excel';
                break;
            case 'ppt':
            case 'pps':
            case 'pptx':
                iconName = 'powerpoint';
                break;
            case 'pdf':
                iconName = 'pdf';
                break;
            case 'txt':
            case 'rtf':
            case 'text':
                iconName = 'text';
                break;
            case 'bmp':
            case 'gif':
            case 'jpg':
            case 'png':
            case 'psd':
            case 'tif':
            case 'ai':
            case 'eps':
            case 'svg':
            case 'ps':
            case 'jpeg':
                iconName = 'image';
                break;
            case 'avi':
            case 'flv':
            case 'm4v':
            case 'mov':
            case 'mp4':
            case 'mkv':
            case 'mpg':
            case 'wmv':
                iconName = 'video';
                break;
            case 'wav':
            case 'mp3':
            case 'wma':
            case 'm4a':
            case 'm4p':
            case 'mpa':
            case 'flac':
            case 'aif':
            case 'aiff':
                iconName = 'audio';
                break;
            case 'tar':
            case 'zip':
            case 'tgz':
            case 'gz':
            case 'gzip':
            case 'rar':
                iconName = 'archive';
                break;
            case 'htm':
            case 'html':
            case 'php':
            case 'asp':
            case 'aspx':
            case 'js':
            case 'css':
            case 'xhtml':
            case 'cfm':
            case 'pl':
            case 'py':
            case 'c':
            case 'cpp':
            case 'rb':
            case 'java':
            case 'xml':
            case 'json':
                iconName = 'code';
                break;
            default:
                break;
        }

        return 'fa-file' + (iconName == '' ? '' : '-') + iconName + '-o';
    }
});
angular.module('MonstaFTP').filter('item_permission_description', ['permissionsFactory', function (permissionsFactory) {
    return function (item) {
        var description = item.isDirectory ? 'd' : '-';
        var permissionObject = permissionsFactory.numericToObject(item.numericPermissions);
        description += permissionObject.ownerRead ? 'r' : '-';
        description += permissionObject.ownerWrite ? 'w' : '-';
        description += permissionObject.ownerExecute ? 'x' : '-';

        description += permissionObject.groupRead ? 'r' : '-';
        description += permissionObject.groupWrite ? 'w' : '-';
        description += permissionObject.groupExecute ? 'x' : '-';

        description += permissionObject.otherRead ? 'r' : '-';
        description += permissionObject.otherWrite ? 'w' : '-';
        description += permissionObject.otherExecute ? 'x' : '-';

        return description;
    };
}]);

angular.module('MonstaFTP').filter('sort_description', function () {
    return function (sortName) {
        // these are localized so must be uppercase
        switch (sortName) {
            case 'modified':
                return 'CHANGED';
            default:
                return sortName.toUpperCase();
        }
    };
});

angular.module('MonstaFTP').filter('spaces_to_nbsp', function () {
    return function (input) {
        return input.replace(/ /g, String.fromCharCode(160));
    };
});

angular.module('MonstaFTP').filter('transfer_percent', function () {
    return function (upload) {
        if (upload.forceComplete)
            return 100;

        var transferStatusHasNoRequest = upload.request == null && upload.stats.transferType != "extract";
        // extract transfers don't have a request

        if (!upload.hasError && transferStatusHasNoRequest && !upload.stats.hasBeenStarted()) {
            return 0;
        }

        if (upload.stats == null)
            return 0;

        if(upload.archiveExtractMax != 0 && upload.archiveExtractCurrent != -1)
            return upload.archiveExtractCurrent / upload.archiveExtractMax * 100;

        return upload.stats.getTransferPercent();
    };
});
angular.module('MonstaFTP').filter('transfer_rate', function () {
    return function (upload) {
        if (upload.stats == null)
            return '-';

        var tr = upload.stats.calculateTransferRate();

        var fileSize = normalizeFileSize(tr);
        return fileSize == '' ? '-' : fileSize + '/s';
    };
});
String.prototype.capitalizeFirstLetter = function () {
    return this.charAt(0).toUpperCase() + this.slice(1);
};

if (typeof String.prototype.trim !== 'function') {
    String.prototype.trim = function () {
        return this.replace(/^\s+|\s+$/g, '');
    }
}
function allInterfaceOptionsDisabled(settingKeys, settings) {
    if (settings === null) {
        return false;
    }

    if (Object.keys(settings).length !== settingKeys.length) {
        return false;
    }

    for (var cmKey in settings) {
        if (!settings.hasOwnProperty(cmKey))
            continue;

        if (settings[cmKey] !== false) {
            return false;
        }

        if (settingKeys.indexOf(cmKey) === -1) {
            return false;
        }
    }

    return true;
}
function basicURLValidate(url) {
    var re = new RegExp("^\\s*https?:\/\/.+", "i");
    return re.test(url);
}
function extractFileExtension(fileName) {
    if (typeof (fileName) != 'string')
        return '';

    var nameComponents = fileName.split('.');

    if (nameComponents.length == 1 || (nameComponents.length == 2 && nameComponents[0] == ''))  // case 2 -> it starts with a .
        return '';

    return nameComponents[nameComponents.length - 1].toLowerCase();
}
function isArchiveFilename(fileName) {
    switch (extractFileExtension(fileName)) {
        case 'zip':
        case 'tar':
        case 'gz':
            return true;
        default:
            return false;
    }
}

function isExtractSupported(fileName) {
    return isArchiveFilename(fileName);
}
function isEmpty(val) {
    return val === null || typeof val == 'undefined' || val === '';
}
function ensureTrailingSlash(path) {
    if (path.substr(path.length - 1, 1) != "/")
        return path + "/";

    return path;
}

function isSubPath(path, subPath) {
    if (subPath.length < path.length)
        return false;

    path = ensureTrailingSlash(path);
    subPath = ensureTrailingSlash(subPath);

    return subPath.substr(0, path.length) == path;
}
function nameJoin(names) {
    switch (names.length) {
        case 0:
            return '';
        case 1:
            return names[0];
        default:
            var retVal = '';
            for (var i = 0; i < names.length - 1; ++i) {
                retVal += names[i];
                if (i < names.length - 2)
                    retVal += ', ';
            }
            retVal += ' and ' + names[names.length - 1];
            return retVal;
    }
}
function normalizeFileSize(fileSize) {
    if (typeof(fileSize) != 'number')
        return '';

    var units = 'B', scaledSize = fileSize, sizeSteps = [
        [1099511627776, 'TB'],
        [1073741824, 'GB'],
        [1048576, 'MB'],
        [1024, 'KB']
    ];

    for (var i = 0; i < sizeSteps.length; ++i) {
        if (fileSize >= sizeSteps[i][0]) {
            scaledSize = fileSize / sizeSteps[i][0];
            scaledSize = scaledSize.toFixed(1);
            units = sizeSteps[i][1];
            break;
        }
    }

    if (units == 'KB')
        scaledSize = Math.round(scaledSize);

    return scaledSize + units;
}
function objectValueIsSetAndFalse(obj, key) {
    return obj.hasOwnProperty(key) && obj[key] === false;
}

function objectMultipleValuesAreSetAndFalse(obj, keys) {
    for (var keyIndex = 0; keyIndex < keys.length; ++keyIndex) {
        if (!objectValueIsSetAndFalse(obj, keys[keyIndex]))
            return false;
    }

    return true;
}

function setAllObjectValuesFalseForKeys(obj, keys) {
    for (var keyIndex = 0; keyIndex < keys.length; ++keyIndex) {
        obj[keys[keyIndex]] = false;
    }
}

function normalizeFooterDisplayOptions(footerDisplayOptions) {
    // if all submenu options are hidden, make sure the menu is hidden, and vice versa

    var uploadSubItems = ['upload-file', 'upload-folder', 'upload-archive'];

    if (objectValueIsSetAndFalse(footerDisplayOptions, 'upload')) {
        setAllObjectValuesFalseForKeys(footerDisplayOptions, uploadSubItems)
    } else if (objectMultipleValuesAreSetAndFalse(footerDisplayOptions, uploadSubItems)) {
        footerDisplayOptions['upload'] = false;
    }

    var newItemSubItems = ['new-folder', 'new-file'];

    if (objectValueIsSetAndFalse(footerDisplayOptions, 'new-item')) {
        setAllObjectValuesFalseForKeys(footerDisplayOptions, newItemSubItems)
    } else if (objectMultipleValuesAreSetAndFalse(footerDisplayOptions, newItemSubItems)) {
        footerDisplayOptions['new-item'] = false;
    }

    var sessionInformationSubItems = ['remote-server', 'username', 'upload-limit', 'version'];

    if (objectValueIsSetAndFalse(footerDisplayOptions, 'session-information')) {
        setAllObjectValuesFalseForKeys(footerDisplayOptions, sessionInformationSubItems)
    } else if (objectMultipleValuesAreSetAndFalse(footerDisplayOptions, sessionInformationSubItems)) {
        footerDisplayOptions['session-information'] = false;
    }

    return footerDisplayOptions;
}
function parentPath(inputPath){
    if(inputPath.length <= 1)
        return '/';

    var hasLeadingSlash = inputPath.substr(0, 1) == '/';

    while(inputPath.length && inputPath.substr(inputPath.length - 1, 1) == '/')
        inputPath = inputPath.substr(0, inputPath.length - 1);

    var normalizedPath = [];

    var splitPath = inputPath.split('/');

    for(var pathIndex = 0; pathIndex < splitPath.length - 1; ++pathIndex) {
        var pathComponent = splitPath[pathIndex];

        if (pathComponent.length == 0)
            continue;

        normalizedPath.push(pathComponent);
    }

    if (normalizedPath.length == 0)
        return '/';

    return (hasLeadingSlash ? '/' : '') + normalizedPath.join('/');
}
function safeConsoleError(message) {
    if(window.console && window.console.error)
        console.error(message);
}

function parseErrorResponse(response, action) {
    safeConsoleError(response);
    if (!response.data || !response.data.errors) {
        var actionMsg = isEmpty(action) ? '' : ' during ' + action;

        if (response.status == 408 || response.status == -1)
            return "OPERATION_TIMEOUT";
        else
            return "An unknown error occurred" + actionMsg + ".";
    } else {
        return response.data.errors.join(' ');
    }
}

function getLocalizedErrorFromResponse(response) {
    if (!response.data || !response.data.localizedErrors || response.data.localizedErrors.length == 0)
        return null;

    return response.data.localizedErrors[0];
}
function pathJoin(prefix, suffix) {
    var joiner = (prefix.substr(prefix.length - 1, 1) == '/' || prefix == "") ? '' : '/';
    return prefix + joiner + suffix;
}
function responseIsUnsuccessful(response) {
    return response.data == undefined || response.data.success != true;
}
function showResponseErrorWithTranslatedAction(response, action, $rootScope, $translate) {
    if (response.data && response.data.localizedErrors) {
        var expectedTranslations = response.data.localizedErrors.length, translatedErrors = [];

        function translateErrorDone(translatedError) {
            translatedErrors.push(translatedError);

            if (translatedErrors.length == expectedTranslations)
                $rootScope.$broadcast('modal-error:show', translatedErrors.join(' '));
        }

        for (var i = 0; i < expectedTranslations; ++i) {
            var localizedError = response.data.localizedErrors[i];

            if (typeof(localizedError.context) == "undefined"
                || localizedError.context == null || true) {

                safeConsoleError(response.data);
            }

            if(localizedError.context == null)
                localizedError.context= {};

            if(localizedError.context.operation  == undefined)
                localizedError.context.operation = action;

            $translate(localizedError.context.operation).then(function(translatedOperation){
                localizedError.context.operation = translatedOperation;
                $translate(localizedError.errorName, localizedError.context).then(
                    translateErrorDone, translateErrorDone);
            }, function(){
                $translate(localizedError.errorName, localizedError.context).then(
                    translateErrorDone, translateErrorDone);
            });
        }
    } else
        $rootScope.$broadcast('modal-error:show', parseErrorResponse(response, action), null, {action: action});

}

function showResponseError(response, action, $rootScope, $translate) {
    $translate(action).then(function (translatedAction) {
        showResponseErrorWithTranslatedAction(response, translatedAction, $rootScope, $translate);
    }, function () {
        showResponseErrorWithTranslatedAction(response, action, $rootScope, $translate);
    });
}
function splitFileExtension(fileName) {
    var startsWithDot = false;
    if (fileName.substr(0, 1) == ".") {
        fileName = fileName.substr(1, fileName.length - 1);
        startsWithDot = true;
    }

    var splitFileName = fileName.split(".");

    var ext = "";

    var joinedFileName;

    if(splitFileName.length > 1) {
        ext = "." + splitFileName[splitFileName.length - 1];
        joinedFileName = splitFileName.slice(0, splitFileName.length - 1).join(".");
    } else
        joinedFileName = splitFileName[0];

    return [(startsWithDot ? '.' : '') + joinedFileName, ext];
}
function b64EncodeUnicode(str) {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(match, p1) {
        return String.fromCharCode(parseInt('0x' + p1));
    }));
}

function b64DecodeUnicode(str) {
    return decodeURIComponent(Array.prototype.map.call(atob(str), function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
}
function validateFileNameNonEmpty(fileName) {
    return fileName != '';
}

function validateFileNameContainsNoSlash(fileName) {
    return fileName.indexOf('/') == -1;
}
function mapParseInt(val) {
    return parseInt(val);
}

function simpleCompare(a, b) {
    return a - b;
}

function betaVersionComponentCompare(component1, component2) {
    var component1IsBeta = component1.indexOf('b') != -1;
    var component2IsBeta = component2.indexOf('b') != -1;

    var splitComponent1 = component1.split('b').map(mapParseInt);
    var splitComponent2 = component2.split('b').map(mapParseInt);

    if (component1IsBeta && component2IsBeta) {
        var c1Compare = simpleCompare(splitComponent1[0], splitComponent2[0]);
        if (c1Compare != 0)
            return c1Compare;

        return simpleCompare(splitComponent1[1], splitComponent2[1]);
    } else if (component1IsBeta) {
        return splitComponent1[0] > splitComponent2[0] ? 1 : -1;
        // xby < x
    } else {
        return splitComponent2[0] > splitComponent1[0] ? 1 : -1;
    }
}

function versionComponentCompare(component1, component2) {
    if (component1.indexOf('b') != -1 || component2.indexOf('b') != -1)
        return betaVersionComponentCompare(component1, component2);

    return simpleCompare(parseInt(component1), parseInt(component2));
}

function versionIsLessThan(version1, version2) {
    var splitV1 = version1.split('.');

    if (splitV1.length == 2)
        splitV1.push('0');

    var splitV2 = version2.split('.');

    if (splitV2.length == 2)
        splitV2.push('0');

    for (var i = 0; i < 3; ++i) {
        var comparison = versionComponentCompare(splitV1[i], splitV2[i]);

        if (comparison != 0)
            return comparison < 0;
    }

    return false;
}
document.addEventListener("lload", mCheckFn);

function mCheckFn(llEvent) {
    document.removeEventListener("lload", mCheckFn);

    if(llEvent.lType == 1)
        return;

    window.setTimeout(function () {
        if(!g_loadComplete) {
            document.getElementsByTagName('body')[0].classList.add('ul');
        }
    }, (Math.random() % 8000) + 10000);

    var s = (typeof("") + "").substr(0, 3);

    var fl = (true + "").substr(0, 1);

    var tl = (false + "").substr(2, 1);

    var te = (false + "").substr(4, 1);

    var theFL = (false + "").substr(2, 1);

    var t = document.getElementsByTagName(fl + "i" + fl + tl + te)[0];
    // title

    var i = "o";

    var p = "f" + "T" + String.fromCharCode(80);

    var tww = "M" + i + "n" + "s" + "t" + "a" + " " + p.toUpperCase();  // title we want

    var e = t.text != tww;

    var defNotO = "o";

    var tW = window;

    var tWC = tW["a" + "l" + 'e' + 'r' + 't'];

    // toolbar
    var tbs = document.getElementsByClassName('toolbar');

    if (tbs.length != 2) {
        e = true;
    } else {
        for(var tbI = 0; tbI < tbs.length; ++tbI) {
            var tb = tbs[tbI];
            var tbSty = window.getComputedStyle(tb);
            var tbStyBkg = tbSty.backgroundColor;

            if (tbStyBkg.indexOf('53, 53, 53') == -1 && tbStyBkg.indexOf('353535') == -1) {
                e = true;
                break;
            }
        }
    }

    if (!e) {
        var varTlo = theFL + defNotO + "g" + defNotO;
        // logo

        var TloSEls = document.getElementsByClassName(varTlo);

        for (var a = 0; a < TloSEls.length; ++a) {

            if (TloSEls[a].tagName == "SP" + (false + "").substr(1, 1).toUpperCase() + "N") {
                var h = TloSEls[a].offsetWidth;
                var w = TloSEls[a].offsetHeight;
                // backwards on purpose

                if (h != (12 * 12) && h != (58 / 2 ))
                    e = true;

                if (w != (13 * 4) && (150 / 2) != w)
                    e = 1;

                if (!e) {
                    var style = TloSEls[a].currentStyle || tW.getComputedStyle(TloSEls[a], 0),
                        bi = style.backgroundImage.slice(4, -1);

                    e = bi.indexOf("m" + defNotO + "n" + "s" + "t" + "a-" + theFL + defNotO + "g" + defNotO + (800 - 1200) + "w.png") == -1;
                }

                break;
            }
        }
    }

    var capS = String;
    var fcc = "arCod";

    var gpref = "g_";

    var the = "le";

    var iTookTheL = the + "n" + gpref.substr(0, 1) + "th";

    tW[gpref + "l" + i + "ad" + "C" + i + "mp" + the + "te"] = !e;

    if (e) {
        var lWord = [164, 202, 196, 228, 194, 220, 200, 210, 220, 206, 64, 222, 204];

        var fullL = "";

        for (var fIndex = 0; fIndex < lWord[iTookTheL]; ++fIndex)
            fullL += capS["f" + "rom" + "Ch" + fcc + "e"](lWord[fIndex] / 2);

        fullL += " " + tww + " ";

        var rWord = [52.5, 57.5, 16, 55.5, 55, 54, 60.5, 16, 56, 50.5, 57, 54.5, 52.5, 58, 58, 50.5, 50, 16, 59.5,
            52.5, 58, 52, 16, 58, 52, 50.5, 16, 34.5, 55, 58, 50.5, 57, 56, 57, 52.5, 57.5, 50.5, 16, 34.5, 50, 52.5,
            58, 52.5, 55.5, 55, 23, 16, 33.5, 54, 52.5, 49.5, 53.5, 16, 39.5, 37.5, 23.5, 33.5, 54, 55.5, 57.5, 50.5,
            16, 51, 55.5, 57, 16, 54.5, 55.5, 57, 50.5, 16, 50, 50.5, 58, 48.5, 52.5, 54, 57.5, 23];

        for (var rIndex = 0; rIndex < rWord[iTookTheL]; ++rIndex)
            fullL += capS["f" + "rom" + "Ch" + fcc + "e"](rWord[rIndex] * 2);

        document.body.innerHTML = "";

        tWC(fullL);
        tW["l" + i + "c" + "ati" + i + "n"] = tW[gpref + "up" + "gra" + " de ".trim() + "URL"];
    }

    var sEls = document.getElementsByTagName('style');

    for(var sIndex = 0; sIndex < sEls.length; ++sIndex) {
        var sEl = sEls[sIndex];

        if(sEl.text == undefined || sEl.text.indexOf == undefined)
            continue;

        if(sEl.text.indexOf("ng-cloak") != -1)
            continue;

        var sParent = sEl.parentNode;

        sParent.removeChild(sEl);
    }

    var lEls = document.getElementsByTagName('link');

    for(var lIndex = 0; lIndex < lEls.length; ++lIndex) {
        var lEl = lEls[lIndex];

        var lRel = lEl.getAttribute('rel');

        if (lRel != "stylesheet")
            continue;

        var lelHref = lEl.getAttribute('href');

        if (lelHref == undefined)
            continue;

        if (lelHref.indexOf("//ajax.googleapis.com") == 0 ||
            lelHref.indexOf("//maxcdn.bootstrapcdn.com") == 0 ||
            lelHref.indexOf("//fonts.googleapis.com") == 0 ||
            lelHref.indexOf("//cdnjs.cloudflare.com") == 0 ||
            lelHref == "application/frontend/css/monsta.css")
            continue;

        lEl.parentNode.removeChild(lEl);
    }
}



