import * as React from 'react';
import styles from './index.module.css';

export default function Footer() {
  return (
    <p className={styles.footer}>
      <span className={styles.logo}>Made by Shaoqun with Love</span>
      <br />
      <span className={styles.copyright}>© 2023-Present Shaoqun Liu</span>
    </p>
  );
}
