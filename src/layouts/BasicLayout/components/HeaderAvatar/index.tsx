import * as React from 'react';
import { Avatar, Overlay, Menu, Icon } from '@alifd/next';
import styles from './index.module.css';

const { Item } = Menu;
const { Popup } = Overlay;

export interface Props {
  name: string;
  avatar: string;
  mail: string;
}

const UserProfile = ({ name, avatar, mail }) => {
  return (
    <div className={styles.profile}>
      <div className={styles.avatar}>
        <Avatar src={avatar} alt="用户头像" />
      </div>
      <div className={styles.content}>
        <h4>{name}</h4>
        <span>{mail}</span>
      </div>
    </div>
  );
};

const HeaderAvatar = (props: Props) => {
  const { name, avatar } = props;
  return (
    <Popup
      trigger={
        <div className={styles.headerAvatar}>
          <Avatar size="small" src={avatar} alt="用户头像" />
          <span style={{ marginLeft: 10 }}>{name}</span>
        </div>
      }
      triggerType="click"
    >
      <div className={styles.avatarPopup}>
        <UserProfile {...props} />
        <Menu className={styles.menu}>
          <Item onClick={() => {
            window.open('https://www.shaoqunliu.cn/');
          }}><Icon size="small" type="account" />个人主页</Item>
        </Menu>
      </div>
    </Popup>
  );
};

HeaderAvatar.defaultProps = {
  name: 'Shaoqun Liu',
  mail: 'liuinstein@gmail.com',
  avatar: 'https://bucket.shaoqunliu.cn/image/avatar.png',
};

export default HeaderAvatar;
