<?php
    require_once(dirname(__FILE__) . "/ListItem.php");
    require_once(dirname(__FILE__) . '/IntegerPermissionSet.php');

    class PHPSecliblistItem extends ListItem {
        public function __construct($itemName, $itemStat) {
            $this->name = $itemName;
            $this->link = $itemStat['type'] == NET_SFTP_TYPE_SYMLINK;
            $this->directory = $itemStat['type'] == NET_SFTP_TYPE_DIRECTORY;
            $permissionBits = $itemStat['permissions'] & PERMISSION_BIT_MASK;
            $this->ownerPermissions = new IntegerPermissionSet($permissionBits >> 6);
            $this->groupPermissions = new IntegerPermissionSet(($permissionBits >> 3) & 0x7);
            $this->otherPermissions = new IntegerPermissionSet($permissionBits & 0x7);
            $this->linkCount = null;
            $this->ownerUserName = isset($itemStat['uid']) ? $itemStat['uid'] : null;
            $this->ownerGroupName = isset($itemStat['gid']) ? $itemStat['gid'] : null;
            $this->size = isset($itemStat['size']) ? $itemStat['size'] : 0;
            $this->modificationDate = $itemStat['mtime'];
        }
    }