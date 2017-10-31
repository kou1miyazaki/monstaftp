<?php

    require_once(dirname(__FILE__) . "/../file_sources/PathOperations.php");

    /**
     * Class HTTPFetchRequest
     */
    class HTTPFetchRequest {
        /**
         * @var string
         */
        private $url;

        /**
         * @var null string
         */
        private $fileNameFromHeader = null;

        /**
         * @var string
         */
        private $destinationDirectory;

        /**
         * HTTPFetchRequest constructor.
         * @param $url string
         * @param $destinationDirectory string
         */
        public function __construct($url, $destinationDirectory) {
            $this->url = $url;
            $this->destinationDirectory = $destinationDirectory;
        }

        public function getFileName($effectiveUrl) {
            return $this->fileNameFromHeader != null ? $this->fileNameFromHeader :
                $this->getFileNameFromURL($effectiveUrl);
        }

        private function getFileNameFromURL($effectiveUrl) {
            return basename($effectiveUrl);
        }

        public function getUploadPath($effectiveUrl) {
            return PathOperations::join($this->destinationDirectory, $this->getFileName($effectiveUrl));
        }

        public function getURL() {
            return $this->url;
        }

        private function parseContentDispositionHeader($headerContents) {
            $fileNameIdentifier = "filename=";
            $fileNamePosition = strpos($headerContents, "filename=");

            if ($fileNamePosition !== false) {
                $headerFilename = substr($headerContents, $fileNamePosition + strlen($fileNameIdentifier));

                if (substr($headerFilename, 0, 1) == '"' && substr($headerFilename, -1) == '"')
                    $headerFilename = substr($headerFilename, 1, strlen($headerFilename) - 2);

                $this->fileNameFromHeader = $headerFilename;
            }
        }

        public function handleCurlHeader($ch, $headerLine) {
            $splitHeaderLine = explode(":", $headerLine, 2);
            if (strtolower($splitHeaderLine[0]) == "content-disposition")
                $this->parseContentDispositionHeader(trim($splitHeaderLine[1]));

            return strlen($headerLine);
        }
    }