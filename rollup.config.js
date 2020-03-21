import babel from 'rollup-plugin-babel';
import uglify from 'rollup-plugin-uglify';
import resolve from '@rollup/plugin-node-resolve';

const source = {
    input: 'src/pristine',
    output: {
        file: 'dist/pristine.js',
        format: 'umd',
        name: 'Pristine'
    },
    plugins: [
        resolve(),
        babel({
            exclude: 'node_modules/**',
        })
    ]
};

const minified = {
    input: 'src/pristine',
    output: {
        file: 'dist/pristine.min.js',
        format: 'umd',
        name: 'Pristine'
    },
    plugins: [
        resolve(),
        babel({
            exclude: 'node_modules/**',
        }),
        uglify()
    ]
};

export  default [source, minified];